use crate::{
    AppState,
    rewriting::{self, Transform},
    security, url_mapping,
};
use axum::{
    Json,
    body::Body,
    extract::{Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::StreamExt;
use serde::Deserialize;
use url::Url;

pub fn error(status: StatusCode, message: impl AsRef<str>) -> Response {
    let message = message
        .as_ref()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>Raxcalite · Unable to load</title><style>body{{font:16px system-ui;background:#12141b;color:#e8eaf1;max-width:520px;margin:15vh auto;padding:24px}}h1{{font-size:24px}}p{{color:#b3b8c8}}</style><h1>Unable to open this page</h1><p>{message}</p><p>Check the address or try again.</p>"
    );
    (
        status,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        html,
    )
        .into_response()
}
fn virtual_referrer(headers: &HeaderMap, proxy_origin: &str) -> Option<Url> {
    let actual = Url::parse(headers.get(header::REFERER)?.to_str().ok()?).ok()?;
    if actual.origin().ascii_serialization() != proxy_origin {
        return None;
    }
    url_mapping::decode(actual.path(), actual.query()).ok()
}
fn hop_header(name: &str) -> bool {
    matches!(
        name,
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}
pub async fn proxy(State(state): State<AppState>, request: Request) -> Response {
    match do_proxy(state, request).await {
        Ok(res) => res,
        Err((code, message)) => {
            let cors = message.contains("CORS") || message.contains("same-origin request");
            let mut response = error(code, message);
            if cors {
                response
                    .headers_mut()
                    .insert("x-rax-cors-error", HeaderValue::from_static("true"));
                // Terminate the HTTP body so native XHR reports a network error
                // (status 0, error/loadend), rather than a readable proxy 403.
                *response.body_mut() = Body::from_stream(futures_util::stream::once(async {
                    Err::<bytes::Bytes, _>(std::io::Error::other("Virtual CORS rejected"))
                }));
            }
            response
        }
    }
}
async fn do_proxy(state: AppState, request: Request) -> Result<Response, (StatusCode, String)> {
    let fail = |m: &str| (StatusCode::BAD_GATEWAY, m.to_owned());
    let permit = state.limit.clone().try_acquire_owned().map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "Proxy concurrency limit reached".into(),
        )
    })?;
    let mut target = url_mapping::decode(request.uri().path(), request.uri().query())
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let worker_marker = target
        .query_pairs()
        .find(|(key, _)| key == "__rax_worker")
        .map(|(_, value)| value.into_owned());
    if worker_marker.is_some() {
        let remaining = target
            .query()
            .unwrap_or("")
            .split('&')
            .filter(|pair| pair.split('=').next() != Some("__rax_worker"))
            .collect::<Vec<_>>()
            .join("&");
        target.set_query(if remaining.is_empty() {
            None
        } else {
            Some(&remaining)
        });
    }
    security::validate_url(&target, &state.config.fixture_hosts)
        .map_err(|e| (StatusCode::FORBIDDEN, e))?;
    if !matches!(target.scheme(), "http" | "https") {
        return Err((
            StatusCode::BAD_REQUEST,
            "Use the WebSocket route for sockets".into(),
        ));
    }
    let (parts, body) = request.into_parts();
    let (id, session, fresh) = state
        .sessions
        .get(&parts.headers)
        .await
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e))?;
    if !session.lock().await.allow() {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Session request limit reached".into(),
        ));
    }
    let referer = virtual_referrer(&parts.headers, &state.config.proxy_origin);
    let virtual_origin = parts
        .headers
        .get("x-rax-origin")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Url::parse(v).ok())
        .or_else(|| referer.clone());
    let same_origin = virtual_origin
        .as_ref()
        .is_none_or(|u| u.origin() == target.origin());
    let mode = parts
        .headers
        .get("x-rax-credentials")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("include");
    let credentials = mode != "omit" && (mode != "same-origin" || same_origin);
    let request_mode = parts
        .headers
        .get("x-rax-mode")
        .or_else(|| parts.headers.get("sec-fetch-mode"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("navigate");
    if !same_origin && request_mode == "same-origin" {
        return Err((
            StatusCode::FORBIDDEN,
            "Virtual same-origin request rejected".into(),
        ));
    }
    let cors_origin = if !same_origin && request_mode == "cors" {
        virtual_origin
            .as_ref()
            .map(|u| u.origin().ascii_serialization())
    } else {
        None
    };
    let mut outgoing = HeaderMap::new();
    let connection_fields: Vec<_> = parts
        .headers
        .get(header::CONNECTION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim().to_ascii_lowercase())
        .collect();
    for (name, value) in &parts.headers {
        let name_str = name.as_str();
        if hop_header(name_str)
            || connection_fields.iter().any(|s| s == name_str)
            || name_str.starts_with("x-rax-")
            || name_str.starts_with("sec-")
            || matches!(
                name_str,
                "host" | "cookie" | "origin" | "referer" | "accept-encoding" | "content-length"
            )
        {
            continue;
        }
        if name_str == "authorization" && !same_origin {
            continue;
        }
        outgoing.insert(name.clone(), value.clone());
    }
    if let Some(referrer) = &referer
        && let Ok(value) = HeaderValue::from_str(&if referrer.origin() == target.origin() {
            referrer.as_str().to_owned()
        } else {
            format!("{}/", referrer.origin().ascii_serialization())
        })
    {
        outgoing.insert(header::REFERER, value);
    }
    if (parts.headers.contains_key(header::ORIGIN) || cors_origin.is_some())
        && let Some(origin) = &virtual_origin
        && let Ok(value) = HeaderValue::from_str(&origin.origin().ascii_serialization())
    {
        outgoing.insert(header::ORIGIN, value);
    }
    if credentials {
        let jar = session.lock().await;
        let value = jar
            .cookies
            .matches(&target)
            .into_iter()
            .filter(|cookie| {
                crate::cookies::permitted(
                    cookie,
                    virtual_origin.as_ref(),
                    &target,
                    request_mode == "navigate"
                        && parts
                            .headers
                            .get("sec-fetch-dest")
                            .and_then(|v| v.to_str().ok())
                            != Some("iframe"),
                    ["GET", "HEAD", "OPTIONS", "TRACE"].contains(&parts.method.as_str()),
                )
            })
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect::<Vec<_>>()
            .join("; ");
        if !value.is_empty() {
            outgoing.insert(
                header::COOKIE,
                HeaderValue::from_str(&value).map_err(|_| fail("Invalid virtual cookie"))?,
            );
        }
    }
    if parts
        .headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .is_some_and(|n| n > 64 * 1024 * 1024)
    {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "Request body exceeds 64 MiB".into(),
        ));
    }
    let deadline = tokio::time::Instant::now() + state.config.timeout;
    let upload = futures_util::stream::unfold(
        (body.into_data_stream(), 0usize),
        move |(mut stream, mut size)| async move {
            match tokio::time::timeout_at(deadline, stream.next()).await {
                Ok(Some(Ok(chunk))) => {
                    size += chunk.len();
                    if size > 64 * 1024 * 1024 {
                        Some((
                            Err(std::io::Error::other("Upload limit exceeded")),
                            (stream, size),
                        ))
                    } else {
                        Some((Ok(chunk), (stream, size)))
                    }
                }
                Ok(None) => None,
                _ => Some((
                    Err(std::io::Error::other("Upload failed or timed out")),
                    (stream, size),
                )),
            }
        },
    );
    if let Some(origin) = &cors_origin {
        let unsafe_headers = crate::cors::unsafe_headers(&outgoing);
        if !["GET", "HEAD", "POST"].contains(&parts.method.as_str()) || !unsafe_headers.is_empty() {
            let preflight = state
                .client
                .request(reqwest::Method::OPTIONS, target.clone())
                .header(header::ORIGIN, origin)
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, parts.method.as_str())
                .header(
                    header::ACCESS_CONTROL_REQUEST_HEADERS,
                    unsafe_headers.join(", "),
                )
                .send()
                .await
                .map_err(|_| fail("Virtual CORS preflight failed"))?;
            let method_ok = preflight
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_METHODS)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v.split(',').any(|m| m.trim() == parts.method.as_str()));
            let allowed_headers = preflight
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_ascii_lowercase();
            let headers_ok = unsafe_headers
                .iter()
                .all(|name| allowed_headers.split(',').any(|v| v.trim() == name));
            if !preflight.status().is_success()
                || !crate::cors::allowed(preflight.headers(), origin, credentials)
                || !method_ok
                || !headers_ok
            {
                return Err((
                    StatusCode::FORBIDDEN,
                    "Virtual CORS preflight rejected".into(),
                ));
            }
        }
    }
    let cacheable_request = parts.method == axum::http::Method::GET
        && !outgoing.contains_key(header::COOKIE)
        && !outgoing.contains_key(header::AUTHORIZATION);
    let upstream = state
        .client
        .request(parts.method.clone(), target.clone())
        .headers(outgoing)
        .body(reqwest::Body::wrap_stream(upload))
        .send()
        .await
        .map_err(|e| {
            tracing::warn!(
                kind = if e.is_timeout() {
                    "timeout"
                } else {
                    "transport"
                },
                "Upstream connection failed"
            );
            fail("Upstream connection failed or destination DNS was blocked")
        })?;
    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();
    if let Some(origin) = &cors_origin
        && !crate::cors::allowed(&upstream_headers, origin, credentials)
    {
        return Err((
            StatusCode::FORBIDDEN,
            "Upstream CORS policy rejected the virtual origin".into(),
        ));
    }
    if credentials {
        let mut jar = session.lock().await;
        for value in upstream_headers.get_all(header::SET_COOKIE) {
            if let Ok(raw) = value.to_str() {
                match crate::cookies::insert(&mut jar.cookies, raw, &target, false) {
                    Ok(true) => tracing::warn!("Virtual cookie capacity eviction"),
                    Ok(false) => {}
                    Err(_) => tracing::debug!("Upstream cookie rejected"),
                }
            }
        }
    }
    // Reject unvalidated redirects before exposing them to the browser. Native fetch handles method conversion.
    let mut translated_location = None;
    if let Some(location) = upstream_headers
        .get(header::LOCATION)
        .and_then(|v| v.to_str().ok())
    {
        let next = target
            .join(location)
            .map_err(|_| fail("Invalid redirect URL"))?;
        security::validate_url(&next, &state.config.fixture_hosts)
            .map_err(|e| (StatusCode::FORBIDDEN, e))?;
        translated_location = Some(url_mapping::encode(&next));
    }
    let content_type = upstream_headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let destination = parts
        .headers
        .get("sec-fetch-dest")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let kind = if mime == "text/html" {
        Some("html")
    } else if mime == "text/css" {
        Some("css")
    } else if matches!(
        mime.as_str(),
        "text/javascript" | "application/javascript" | "application/x-javascript"
    ) || ["script", "worker", "sharedworker"].contains(&destination)
    {
        Some("js")
    } else {
        None
    };
    let transformed = kind.is_some()
        && parts.method != axum::http::Method::HEAD
        && !matches!(status.as_u16(), 204 | 304)
        && !status.is_redirection();
    let mut response_headers = HeaderMap::new();
    for (name, value) in &upstream_headers {
        let n = name.as_str();
        if hop_header(n)
            || matches!(
                n,
                "set-cookie"
                    | "location"
                    | "access-control-allow-origin"
                    | "access-control-allow-credentials"
                    | "strict-transport-security"
                    | "clear-site-data"
                    | "service-worker-allowed"
            )
        {
            continue;
        }
        if transformed
            && kind == Some("html")
            && matches!(
                n,
                "content-security-policy"
                    | "content-security-policy-report-only"
                    | "x-frame-options"
            )
        {
            continue;
        }
        if transformed
            && matches!(
                n,
                "etag" | "content-md5" | "content-length" | "content-encoding" | "accept-ranges"
            )
        {
            continue;
        }
        response_headers.append(name.clone(), value.clone());
    }
    if let Some(value) = translated_location {
        response_headers.insert(
            header::LOCATION,
            HeaderValue::from_str(&value).map_err(|_| fail("Invalid mapped redirect"))?,
        );
    }
    response_headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("same-origin"),
    );
    if let Some(value) = upstream_headers.get(header::ACCESS_CONTROL_EXPOSE_HEADERS) {
        response_headers.insert("x-rax-exposed-headers", value.clone());
    }
    if fresh {
        response_headers.append(
            header::SET_COOKIE,
            HeaderValue::from_str(&format!(
                "rax_session={id}; Path=/; HttpOnly; SameSite=Strict{}",
                if state.config.proxy_origin.starts_with("https:") {
                    "; Secure"
                } else {
                    ""
                }
            ))
            .unwrap(),
        );
    }
    let response_body;
    if transformed {
        let _transform_permit = state
            .transform_limit
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| fail("Transformer unavailable"))?;
        let mut bytes = Vec::new();
        let mut stream = upstream.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| fail("Upstream body failed"))?;
            if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Transformable response exceeds 4 MiB".into(),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let text = STANDARD.encode(bytes);
        let worker_kind = match worker_marker.as_deref() {
            Some("module") => Some("module"),
            Some("classic") => Some("classic"),
            _ if ["worker", "sharedworker"].contains(&destination)
                && request_mode == "same-origin" =>
            {
                Some("classic")
            }
            _ => None,
        };
        let result = rewriting::rewrite(
            &state,
            Transform {
                cache: cacheable_request && !upstream_headers.contains_key(header::SET_COOKIE),
                kind: kind.unwrap(),
                source: &text,
                encoding: &content_type,
                url: target.as_str(),
                debug: std::env::var("RAX_DEBUG").is_ok_and(|value| value == "1"),
                source_maps: std::env::var("RAX_SOURCE_MAPS").is_ok_and(|value| value == "1"),
                worker: worker_kind,
            },
        )
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
        response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response_headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&format!("{mime}; charset=utf-8")).unwrap(),
        );
        if !result.warnings.is_empty() {
            response_headers.insert(
                "x-rax-rewrite-warnings",
                HeaderValue::from_str(&result.warnings.len().to_string()).unwrap(),
            );
            tracing::warn!(
                count = result.warnings.len(),
                "Resource rewrite reported compatibility warnings"
            );
        }
        if kind == Some("html") {
            response_headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_str(&format!("default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors {} {}; object-src 'none'; base-uri 'self'", state.config.app_origin, state.config.proxy_origin)).unwrap());
            response_headers.insert(
                "permissions-policy",
                HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=()"),
            );
        }
        response_body = Body::from(result.code);
        drop(permit);
    } else {
        if upstream
            .content_length()
            .is_some_and(|n| n > 128 * 1024 * 1024)
        {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "Resource exceeds 128 MiB".into(),
            ));
        }
        response_headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-store"),
        );
        let stream = async_stream(upstream.bytes_stream(), permit);
        response_body = Body::from_stream(stream);
    }
    let mut response = Response::new(response_body);
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    Ok(response)
}
fn async_stream(
    stream: impl futures_util::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + 'static,
    permit: tokio::sync::OwnedSemaphorePermit,
) -> impl futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send {
    stream.scan((0usize, permit), |(size, _), chunk| {
        let result = match chunk {
            Ok(chunk) => {
                *size += chunk.len();
                if *size > 128 * 1024 * 1024 {
                    Err(std::io::Error::other("Response limit exceeded"))
                } else {
                    Ok(chunk)
                }
            }
            Err(_) => Err(std::io::Error::other("Upstream stream failed")),
        };
        futures_util::future::ready(Some(result))
    })
}
#[derive(Deserialize)]
pub struct CookieQuery {
    url: String,
}
fn cookie_target(
    headers: &HeaderMap,
    value: &str,
    state: &AppState,
) -> Result<Url, (StatusCode, &'static str)> {
    let target = Url::parse(value).map_err(|_| (StatusCode::BAD_REQUEST, "Invalid cookie URL"))?;
    let referer = virtual_referrer(headers, &state.config.proxy_origin).ok_or((
        StatusCode::FORBIDDEN,
        "Cookie access requires a virtual document",
    ))?;
    if target.origin() != referer.origin() {
        return Err((StatusCode::FORBIDDEN, "Cross-origin cookie access blocked"));
    }
    Ok(target)
}
pub async fn read_cookie(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(input): Query<CookieQuery>,
) -> Response {
    let target = match cookie_target(&headers, &input.url, &state) {
        Ok(url) => url,
        Err((status, message)) => return error(status, message),
    };
    let (_, session, _) = match state.sessions.get(&headers).await {
        Ok(s) => s,
        Err(e) => return error(StatusCode::SERVICE_UNAVAILABLE, e),
    };
    let jar = session.lock().await;
    let value = jar
        .cookies
        .iter_any()
        .filter(|c| c.matches(&target) && c.http_only() != Some(true) && !c.is_expired())
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    (
        [
            (header::CONTENT_TYPE, "text/plain"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        value,
    )
        .into_response()
}
#[derive(Deserialize)]
pub struct CookieWrite {
    url: String,
    value: String,
}
pub async fn write_cookie(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CookieWrite>,
) -> Response {
    let target = match cookie_target(&headers, &input.url, &state) {
        Ok(url) => url,
        Err((status, message)) => return error(status, message),
    };
    let (_, session, _) = match state.sessions.get(&headers).await {
        Ok(s) => s,
        Err(e) => return error(StatusCode::SERVICE_UNAVAILABLE, e),
    };
    // Page scripts cannot create HttpOnly cookies or overwrite existing HttpOnly cookies.
    if input.value.len() > 4096
        || input.value.split(';').skip(1).any(|p| {
            p.trim()
                .split('=')
                .next()
                .is_some_and(|name| name.eq_ignore_ascii_case("httponly"))
        })
    {
        return error(StatusCode::BAD_REQUEST, "Invalid script cookie");
    }
    let mut jar = session.lock().await;
    if !jar.allow() {
        return error(StatusCode::TOO_MANY_REQUESTS, "Cookie jar limit reached");
    }
    if let Err(message) = crate::cookies::validate(&input.value, &target, true, &jar.cookies) {
        return error(StatusCode::FORBIDDEN, message);
    }
    match crate::cookies::insert(&mut jar.cookies, &input.value, &target, true) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => error(StatusCode::BAD_REQUEST, "Invalid cookie attributes"),
    }
}
pub async fn reset_session(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if headers.get(header::ORIGIN).and_then(|v| v.to_str().ok())
        != Some(state.config.app_origin.as_str())
    {
        return error(
            StatusCode::FORBIDDEN,
            "Session reset is only available in browser settings",
        );
    }
    if let Ok((_, session, _)) = state.sessions.get(&headers).await {
        session.lock().await.cookies = cookie_store::CookieStore::default();
    }
    StatusCode::NO_CONTENT.into_response()
}
