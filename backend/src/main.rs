mod config;
mod cookies;
mod cors;
mod isolation;
mod operations;
mod rewriting;
mod security;
mod sessions;
mod transport;
mod url_mapping;
mod websocket;

use axum::{
    Router,
    http::Method,
    routing::{any, get, post},
};
use config::Config;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};

#[derive(Clone)]
pub struct AppState {
    config: Config,
    client: reqwest::Client,
    transform: reqwest::Client,
    sessions: sessions::Sessions,
    limit: Arc<Semaphore>,
    transform_limit: Arc<Semaphore>,
    metrics: Arc<operations::Metrics>,
    shutdown: tokio::sync::watch::Sender<bool>,
}
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let config = Config::load();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .dns_resolver(Arc::new(security::SafeResolver {
            fixtures: Arc::new(config.fixture_hosts.clone()),
        }))
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(config.timeout)
        .pool_max_idle_per_host(8)
        .build()
        .expect("HTTP client");
    let state = AppState {
        config: config.clone(),
        client,
        transform: reqwest::Client::builder()
            .timeout(config.timeout)
            .no_proxy()
            .build()
            .unwrap(),
        sessions: sessions::Sessions::load().expect("Session storage configuration"),
        limit: Arc::new(Semaphore::new(32)),
        transform_limit: Arc::new(Semaphore::new(8)),
        metrics: Arc::new(operations::Metrics::default()),
        shutdown: tokio::sync::watch::channel(false).0,
    };
    let persisted = state.sessions.clone();
    let shutdown = state.shutdown.clone();
    tokio::spawn(async move {
        operations::shutdown().await;
        let _ = shutdown.send(true);
    });
    let app_shutdown = state.shutdown.subscribe();
    let proxy_shutdown = state.shutdown.subscribe();
    let force_shutdown = state.shutdown.subscribe();
    let maintenance = persisted.clone();
    let cleanup = tokio::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            timer.tick().await;
            maintenance.maintain().await;
            if maintenance.persist().await.is_err() {
                tracing::error!("Encrypted session checkpoint failed");
            }
        }
    });
    let app = Router::new()
        .route("/config.js", get(isolation::app_config))
        .fallback_service(
            ServeDir::new("frontend/dist")
                .not_found_service(ServeFile::new("frontend/dist/index.html")),
        )
        .layer(tower_http::compression::CompressionLayer::new())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            operations::guard,
        ))
        .with_state(state.clone());
    let cors_config = config.clone();
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(
            move |origin, _| {
                origin
                    .to_str()
                    .is_ok_and(|value| isolation::known_origin(value, &cors_config))
            },
        ))
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::HEAD,
            Method::OPTIONS,
        ])
        .allow_headers(tower_http::cors::AllowHeaders::mirror_request());
    let proxy = Router::new()
        .route("/p/{*path}", any(transport::proxy))
        .route("/ws/{*path}", get(websocket::upgrade))
        .route(
            "/api/cookie",
            get(transport::read_cookie).post(transport::write_cookie),
        )
        .route("/health", get(|| async { "Raxcalite OK" }))
        .route("/ready", get(operations::ready))
        .route("/metrics", get(operations::metrics))
        .route("/api/session/reset", post(transport::reset_session))
        .route("/api/session", get(isolation::bootstrap))
        .route("/api/worker-bootstrap", get(isolation::worker_bootstrap))
        .fallback_service(ServeDir::new("frontend/dist").append_index_html_on_directories(false))
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(cors)
        .layer(tower_http::compression::CompressionLayer::new())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            operations::guard,
        ))
        .with_state(state);
    let app_listener =
        tokio::net::TcpListener::bind(format!("{}:{}", config.bind, config.app_port))
            .await
            .expect("App listen");
    let proxy_listener =
        tokio::net::TcpListener::bind(format!("{}:{}", config.bind, config.proxy_port))
            .await
            .expect("Proxy listen");
    println!(
        "Raxcalite: {} (content: {})",
        config.app_origin, config.proxy_origin
    );
    let servers = async {
        tokio::join!(
            axum::serve(app_listener, app)
                .with_graceful_shutdown(operations::wait_shutdown(app_shutdown)),
            axum::serve(proxy_listener, proxy)
                .with_graceful_shutdown(operations::wait_shutdown(proxy_shutdown))
        )
    };
    tokio::pin!(servers);
    tokio::select! {
        _=&mut servers=>{},
        _=operations::wait_shutdown(force_shutdown)=>{let _=tokio::time::timeout(std::time::Duration::from_secs(10),&mut servers).await;}
    }
    cleanup.abort();
    if persisted.persist().await.is_err() {
        tracing::error!("Final session checkpoint failed");
    }
}
