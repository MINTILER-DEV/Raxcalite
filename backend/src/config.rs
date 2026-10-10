use std::{env, time::Duration};

#[derive(Clone)]
pub struct Config {
    pub app_port: u16,
    pub proxy_port: u16,
    pub transform_port: u16,
    pub transform_token: String,
    pub app_origin: String,
    pub proxy_origin: String,
    pub bind: String,
    pub fixture_hosts: Vec<String>,
    pub timeout: Duration,
}
impl Config {
    pub fn load() -> Self {
        let port = |name: &str, default| env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default);
        let app_port = port("RAX_APP_PORT", 3030);
        let proxy_port = port("RAX_PROXY_PORT", 3031);
        Self {
            app_port, proxy_port, transform_port: port("RAX_TRANSFORM_PORT", 3032),
            transform_token: env::var("RAX_TRANSFORM_TOKEN").expect("Start with npm run dev, or set RAX_TRANSFORM_TOKEN"),
            app_origin: env::var("RAX_APP_ORIGIN").unwrap_or(format!("http://localhost:{app_port}")),
            proxy_origin: env::var("RAX_PROXY_ORIGIN").unwrap_or(format!("http://localhost:{proxy_port}")),
            bind: env::var("RAX_BIND").unwrap_or("127.0.0.1".into()),
            fixture_hosts: env::var("RAX_FIXTURE_HOSTS").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(str::to_owned).collect(),
            timeout: Duration::from_secs(30),
        }
    }
}
