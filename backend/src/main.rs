mod config;
mod cookies;
mod cors;
mod operations;
mod rewriting;
mod security;
mod sessions;
mod transport;
mod url_mapping;
mod websocket;

use axum::{
    Router,
    http::{HeaderValue, Method},
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
        sessions: sessions::Sessions::default(),
        limit: Arc::new(Semaphore::new(32)),
        transform_limit: Arc::new(Semaphore::new(8)),
        metrics: Arc::new(operations::Metrics::default()),
    };
    let app = Router::new()
        .fallback_service(
            ServeDir::new("frontend/dist")
                .not_found_service(ServeFile::new("frontend/dist/index.html")),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            operations::guard,
        ));
    let cors = CorsLayer::new()
        .allow_origin(
            config
                .app_origin
                .parse::<HeaderValue>()
                .expect("App origin"),
        )
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([axum::http::header::CONTENT_TYPE]);
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
        .fallback_service(ServeDir::new("frontend/dist").append_index_html_on_directories(false))
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(cors)
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
    let _ = tokio::join!(
        axum::serve(app_listener, app).with_graceful_shutdown(operations::shutdown()),
        axum::serve(proxy_listener, proxy).with_graceful_shutdown(operations::shutdown())
    );
}
