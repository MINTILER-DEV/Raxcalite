use crate::{AppState, security, transport::error, url_mapping};
use axum::{
    extract::{
        OriginalUri, State,
        ws::{Message, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{
    client_async_tls_with_config,
    tungstenite::{
        Message as UpstreamMessage,
        client::IntoClientRequest,
        protocol::{CloseFrame, WebSocketConfig, frame::coding::CloseCode},
    },
};

pub async fn upgrade(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let target = match url_mapping::decode(uri.path(), uri.query()) {
        Ok(u) => u,
        Err(e) => return error(StatusCode::BAD_REQUEST, e),
    };
    if !matches!(target.scheme(), "ws" | "wss") {
        return error(StatusCode::BAD_REQUEST, "Invalid socket protocol");
    }
    if headers.get("origin").and_then(|v| v.to_str().ok())
        != Some(state.config.proxy_origin.as_str())
    {
        return error(StatusCode::FORBIDDEN, "Invalid WebSocket origin");
    }
    let addresses = match security::resolve_socket(&target, &state.config.fixture_hosts).await {
        Ok(a) => a,
        Err(e) => return error(StatusCode::FORBIDDEN, e),
    };
    let (_, session, _) = match state.sessions.get(&headers).await {
        Ok(s) => s,
        Err(e) => return error(StatusCode::SERVICE_UNAVAILABLE, e),
    };
    {
        let mut s = session.lock().await;
        if s.active_ws >= 8 || !s.allow() {
            return StatusCode::TOO_MANY_REQUESTS.into_response();
        }
        s.active_ws += 1;
    }
    let permit = match state.limit.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => {
            session.lock().await.active_ws -= 1;
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let mut request = match target.as_str().into_client_request() {
        Ok(r) => r,
        Err(_) => {
            session.lock().await.active_ws -= 1;
            return error(StatusCode::BAD_REQUEST, "Invalid WebSocket URL");
        }
    };
    if let Some(protocols) = headers.get("sec-websocket-protocol") {
        request
            .headers_mut()
            .insert("sec-websocket-protocol", protocols.clone());
    }
    let cookie = session
        .lock()
        .await
        .cookies
        .get_request_values(&target)
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ");
    if !cookie.is_empty()
        && let Ok(value) = cookie.parse()
    {
        request.headers_mut().insert("cookie", value);
    }
    let mut origin = target.clone();
    origin
        .set_scheme(if target.scheme() == "wss" {
            "https"
        } else {
            "http"
        })
        .ok();
    request.headers_mut().insert(
        "origin",
        origin.origin().ascii_serialization().parse().unwrap(),
    );
    let mut socket_config = WebSocketConfig::default();
    socket_config.max_message_size = Some(4 * 1024 * 1024);
    socket_config.max_frame_size = Some(1024 * 1024);
    let connected = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let mut last = None;
        for address in addresses {
            match tokio::net::TcpStream::connect(address).await {
                Ok(tcp) => {
                    return client_async_tls_with_config(request, tcp, Some(socket_config), None)
                        .await
                        .map_err(|e| e.to_string());
                }
                Err(e) => last = Some(e.to_string()),
            }
        }
        Err(last.unwrap_or("No socket destination".into()))
    })
    .await;
    let (upstream, response) = match connected {
        Ok(Ok(c)) => c,
        _ => {
            session.lock().await.active_ws -= 1;
            return error(
                StatusCode::BAD_GATEWAY,
                "WebSocket upstream connection failed",
            );
        }
    };
    let selected = response
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let ws = if let Some(protocol) = selected {
        ws.protocols([protocol])
    } else {
        ws
    };
    ws.max_message_size(4 * 1024 * 1024).max_frame_size(1024 * 1024).on_upgrade(move |socket| async move {
        let _permit = permit;
        let (mut browser_tx, mut browser_rx) = socket.split();
        let (mut upstream_tx, mut upstream_rx) = upstream.split();
        let forward = async {
            while let Some(Ok(message)) = browser_rx.next().await {
                let message = match message {
                    Message::Text(t) => UpstreamMessage::Text(t.as_str().into()), Message::Binary(b) => UpstreamMessage::Binary(b),
                    Message::Ping(b) => UpstreamMessage::Ping(b), Message::Pong(b) => UpstreamMessage::Pong(b),
                    Message::Close(c) => UpstreamMessage::Close(c.map(|c| CloseFrame { code: CloseCode::from(c.code), reason: c.reason.as_str().into() })),
                };
                if upstream_tx.send(message).await.is_err() { break; }
            }
        };
        let backward = async {
            while let Some(Ok(message)) = upstream_rx.next().await {
                let message = match message {
                    UpstreamMessage::Text(t) => Message::Text(t.as_str().into()), UpstreamMessage::Binary(b) => Message::Binary(b),
                    UpstreamMessage::Ping(b) => Message::Ping(b), UpstreamMessage::Pong(b) => Message::Pong(b),
                    UpstreamMessage::Close(c) => Message::Close(c.map(|c| axum::extract::ws::CloseFrame { code: u16::from(c.code), reason: c.reason.as_str().into() })),
                    _ => continue,
                };
                if browser_tx.send(message).await.is_err() { break; }
            }
        };
        tokio::select! { _ = forward => {}, _ = backward => {}, _ = tokio::time::sleep(std::time::Duration::from_secs(3600)) => {} }
        session.lock().await.active_ws -= 1;
    })
}
