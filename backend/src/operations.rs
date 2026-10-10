use crate::{AppState, transport};
use axum::{
    Json,
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct Metrics {
    pub requests: AtomicU64,
    pub errors: AtomicU64,
}

pub async fn guard(State(state): State<AppState>, request: Request, next: Next) -> Response {
    // Reject DNS-rebinding Host names. Forwarded headers never establish trust.
    let host = request
        .headers()
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if state.config.isolation_domain.is_some()
        && host == format!("localhost:{}", state.config.app_port)
    {
        return (
            StatusCode::TEMPORARY_REDIRECT,
            [(
                "location",
                format!("{}{}", state.config.app_origin, request.uri()),
            )],
        )
            .into_response();
    }
    let protocol = url::Url::parse(&state.config.proxy_origin)
        .unwrap()
        .scheme()
        .to_owned();
    let allowed = crate::isolation::known_origin(&format!("{protocol}://{host}"), &state.config)
        || (["/health", "/ready"].contains(&request.uri().path())
            && [
                format!("127.0.0.1:{}", state.config.proxy_port),
                format!("localhost:{}", state.config.proxy_port),
            ]
            .contains(&host.to_owned()));
    if !allowed {
        return transport::error(StatusCode::MISDIRECTED_REQUEST, "Unknown gateway host");
    }
    // A native Location alias can navigate to / instead of a /p/ URL. Recover
    // origin-relative paths only on an authenticated, previously visited site
    // host. Keep gateway/runtime routes reserved and preserve POST via 307.
    let path = request.uri().path();
    let reserved = path.starts_with("/p/")
        || path.starts_with("/ws/")
        || path.starts_with("/assets/")
        || [
            "/api/cookie",
            "/api/session",
            "/api/session/reset",
            "/api/worker-bootstrap",
            "/health",
            "/ready",
            "/metrics",
            "/config.js",
            "/runtime.js",
            "/worker-runtime.js",
            "/sw.js",
            "/icon.svg",
            "/asset-manifest.json",
        ]
        .contains(&path);
    if state.config.isolation_domain.is_some()
        && !reserved
        && host
            != url::Url::parse(&state.config.app_origin)
                .unwrap()
                .authority()
        && host
            != url::Url::parse(&state.config.proxy_origin)
                .unwrap()
                .authority()
    {
        if let Ok((_, session, false)) = state.sessions.get(request.headers()).await {
            let current = session.lock().await;
            if let Some(mut target) = current
                .origins
                .values()
                .filter_map(|value| url::Url::parse(value).ok())
                .find(|url| {
                    crate::isolation::origin(url, &state.config, &current)
                        == format!("{protocol}://{host}")
                })
            {
                target.set_path(path);
                target.set_query(request.uri().query());
                let mut response = (
                    StatusCode::TEMPORARY_REDIRECT,
                    [
                        (
                            "location",
                            crate::isolation::mapped(&target, &state.config, &current),
                        ),
                        ("cache-control", "no-store".into()),
                    ],
                )
                    .into_response();
                if let Some(origin) = request.headers().get("origin").filter(|value| {
                    value
                        .to_str()
                        .is_ok_and(|value| crate::isolation::known_origin(value, &state.config))
                }) {
                    response
                        .headers_mut()
                        .insert("access-control-allow-origin", origin.clone());
                    response.headers_mut().insert(
                        "access-control-allow-credentials",
                        axum::http::HeaderValue::from_static("true"),
                    );
                }
                return response;
            }
        }
        return transport::error(
            StatusCode::FORBIDDEN,
            "Origin-relative route requires an authenticated virtual site",
        );
    }
    state.metrics.requests.fetch_add(1, Ordering::Relaxed);
    let response = next.run(request).await;
    if response.status().is_client_error() || response.status().is_server_error() {
        state.metrics.errors.fetch_add(1, Ordering::Relaxed);
    }
    response
}
pub async fn ready(State(state): State<AppState>) -> Response {
    let result = state
        .transform
        .get(format!(
            "http://127.0.0.1:{}/health",
            state.config.transform_port
        ))
        .bearer_auth(&state.config.transform_token)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;
    if result.is_ok_and(|r| r.status().is_success()) {
        (StatusCode::OK, "Raxcalite ready").into_response()
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "Transformer unavailable").into_response()
    }
}
pub async fn metrics(State(state): State<AppState>, request: Request<Body>) -> Response {
    // Operational details are restricted to the same authenticated sidecar secret.
    if request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        != Some(format!("Bearer {}", state.config.transform_token).as_str())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    Json(serde_json::json!({"requests": state.metrics.requests.load(Ordering::Relaxed), "errors": state.metrics.errors.load(Ordering::Relaxed), "active": 32-state.limit.available_permits(), "transforms": 8-state.transform_limit.available_permits()})).into_response()
}
pub async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("signal");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
pub async fn wait_shutdown(mut receiver: tokio::sync::watch::Receiver<bool>) {
    if !*receiver.borrow() {
        let _ = receiver.changed().await;
    }
}
