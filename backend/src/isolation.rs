use crate::{config::Config, sessions::Session, url_mapping};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Isolation {
    pub domain: String,
    pub user: String,
    pub proxy_origin: String,
}
pub fn settings(config: &Config, session: &Session) -> Option<Isolation> {
    config.isolation_domain.as_ref().map(|domain| Isolation {
        domain: domain.clone(),
        user: session.public_id.clone(),
        proxy_origin: config.proxy_origin.clone(),
    })
}
pub fn site_hash(target: &Url) -> String {
    let mut target = target.clone();
    if target.scheme() == "ws" {
        target.set_scheme("http").unwrap();
    } else if target.scheme() == "wss" {
        target.set_scheme("https").unwrap();
    }
    Sha256::digest(target.origin().ascii_serialization())
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub fn origin(target: &Url, config: &Config, session: &Session) -> String {
    let Some(domain) = &config.isolation_domain else {
        return config.proxy_origin.clone();
    };
    let mut actual = Url::parse(&config.proxy_origin).unwrap();
    actual
        .set_host(Some(&format!(
            "{}-{}.{}",
            session.public_id,
            site_hash(target),
            domain
        )))
        .unwrap();
    actual.origin().ascii_serialization()
}
pub fn mapped(target: &Url, config: &Config, session: &Session) -> String {
    if config.isolation_domain.is_some() {
        format!(
            "{}{}",
            origin(target, config, session),
            url_mapping::encode(target)
        )
    } else {
        url_mapping::encode(target)
    }
}
pub fn known_origin(actual: &str, config: &Config) -> bool {
    if actual == config.app_origin || actual == config.proxy_origin {
        return true;
    }
    let Some(domain) = &config.isolation_domain else {
        return false;
    };
    let Ok(url) = Url::parse(actual) else {
        return false;
    };
    let proxy = Url::parse(&config.proxy_origin).unwrap();
    url.scheme() == proxy.scheme()
        && url.port_or_known_default() == proxy.port_or_known_default()
        && url.host_str().is_some_and(|host| {
            let Some(label) = host.strip_suffix(&format!(".{domain}")) else {
                return false;
            };
            label.len() == 57
                && label.as_bytes()[24] == b'-'
                && label
                    .bytes()
                    .enumerate()
                    .all(|(i, b)| i == 24 || b.is_ascii_hexdigit())
        })
}
pub fn cookie(id: &str, config: &Config) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "rax_session={id}; Path=/; HttpOnly; SameSite=Strict{}{}",
        if config.proxy_origin.starts_with("https:") {
            "; Secure"
        } else {
            ""
        },
        config
            .isolation_domain
            .as_ref()
            .map(|d| format!("; Domain={d}"))
            .unwrap_or_default()
    ))
    .unwrap()
}
pub fn source(headers: &HeaderMap, config: &Config, session: &Session) -> Option<Url> {
    let actual = headers
        .get("origin")
        .or_else(|| headers.get("referer"))?
        .to_str()
        .ok()?;
    let actual = Url::parse(actual).ok()?;
    let base = actual.origin().ascii_serialization();
    session.origins.values().find_map(|virtual_origin| {
        let source = Url::parse(virtual_origin).ok()?;
        if origin(&source, config, session) != base {
            return None;
        }
        url_mapping::decode(actual.path(), actual.query())
            .ok()
            .filter(|u| u.origin() == source.origin())
            .or(Some(source))
    })
}
pub async fn bootstrap(State(state): State<crate::AppState>, headers: HeaderMap) -> Response {
    if headers.get("origin").and_then(|v| v.to_str().ok()) != Some(state.config.app_origin.as_str())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let (id, session, _) = match state.sessions.get(&headers).await {
        Ok(s) => s,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let mut response =
        Json(serde_json::json!({"isolation":settings(&state.config, &*session.lock().await)}))
            .into_response();
    response
        .headers_mut()
        .insert("set-cookie", cookie(&id, &state.config));
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    response
}
pub async fn app_config(State(state): State<crate::AppState>) -> Response {
    let data = serde_json::json!({"proxyOrigin":state.config.proxy_origin,"isolationDomain":state.config.isolation_domain});
    (
        [
            ("content-type", "text/javascript; charset=utf-8"),
            ("cache-control", "no-store"),
        ],
        format!(
            "globalThis.__RAX_APP_CONFIG__={};",
            data.to_string().replace('<', "\\u003c")
        ),
    )
        .into_response()
}
