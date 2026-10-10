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
    pub isolation_domain: Option<String>,
}
impl Config {
    pub fn load() -> Self {
        let bind = env::var("RAX_BIND").unwrap_or("127.0.0.1".into());
        if !["127.0.0.1", "::1", "localhost"].contains(&bind.as_str()) {
            assert!(
                env::var("RAX_TRUSTED_GATEWAY").is_ok_and(|v| v == "1"),
                "Public binding requires RAX_TRUSTED_GATEWAY=1 behind an authenticated gateway"
            );
        }
        let port = |name: &str, default| {
            env::var(name)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(default)
        };
        let app_port = port("RAX_APP_PORT", 3030);
        let proxy_port = port("RAX_PROXY_PORT", 3031);
        let value = Self {
            app_port,
            proxy_port,
            transform_port: port("RAX_TRANSFORM_PORT", 3032),
            transform_token: env::var("RAX_TRANSFORM_TOKEN")
                .expect("Start with npm run dev, or set RAX_TRANSFORM_TOKEN"),
            app_origin: env::var("RAX_APP_ORIGIN")
                .unwrap_or(format!("http://localhost:{app_port}")),
            proxy_origin: env::var("RAX_PROXY_ORIGIN")
                .unwrap_or(format!("http://localhost:{proxy_port}")),
            bind,
            fixture_hosts: env::var("RAX_FIXTURE_HOSTS")
                .unwrap_or_default()
                .split(',')
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            timeout: Duration::from_secs(30),
            isolation_domain: env::var("RAX_ISOLATION_DOMAIN").ok(),
        };
        let app = url::Url::parse(&value.app_origin).expect("App URL");
        let proxy = url::Url::parse(&value.proxy_origin).expect("Content URL");
        assert!(
            app.origin() != proxy.origin(),
            "Shell and content must have distinct origins"
        );
        if let Some(domain) = &value.isolation_domain {
            assert!(
                domain.len() < 190
                    && domain.split('.').all(|part| !part.is_empty()
                        && part.len() < 64
                        && part
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')),
                "Invalid isolation domain"
            );
            assert!(
                proxy.host_str() == Some(domain)
                    && app
                        .host_str()
                        .is_some_and(|h| h.ends_with(&format!(".{domain}"))),
                "Content base and shell must share the configured isolation domain"
            );
            assert!(
                app.scheme() == proxy.scheme(),
                "Use the same shell/content scheme"
            );
            assert!(
                proxy.scheme() == "https" || domain.ends_with(".localhost"),
                "Isolated public origins require HTTPS"
            );
        }
        value
    }
}
