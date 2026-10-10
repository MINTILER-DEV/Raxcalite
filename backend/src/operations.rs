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
    let allowed = [&state.config.app_origin, &state.config.proxy_origin]
        .iter()
        .any(|origin| {
            let url = url::Url::parse(origin).expect("configured origin");
            let authority = &url[url::Position::BeforeHost..url::Position::AfterPort];
            request.headers().get("host").and_then(|h| h.to_str().ok()) == Some(authority)
        });
    if !allowed {
        return transport::error(StatusCode::MISDIRECTED_REQUEST, "Unknown gateway host");
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
