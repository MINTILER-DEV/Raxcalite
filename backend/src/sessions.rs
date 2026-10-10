use axum::http::HeaderMap;
use cookie_store::CookieStore;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

pub struct Session {
    pub cookies: CookieStore,
    pub touched: Instant,
    pub window: Instant,
    pub requests: u32,
    pub active_ws: usize,
}
impl Session {
    fn new() -> Self {
        Self {
            cookies: CookieStore::default(),
            touched: Instant::now(),
            window: Instant::now(),
            requests: 0,
            active_ws: 0,
        }
    }
    pub fn allow(&mut self) -> bool {
        self.touched = Instant::now();
        if self.window.elapsed() > Duration::from_secs(60) {
            self.window = Instant::now();
            self.requests = 0;
        }
        self.requests += 1;
        self.requests <= 600
    }
}
#[derive(Clone, Default)]
pub struct Sessions(Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>);
impl Sessions {
    pub async fn get(
        &self,
        headers: &HeaderMap,
    ) -> Result<(String, Arc<Mutex<Session>>, bool), String> {
        let supplied = headers
            .get("cookie")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                s.split(';')
                    .find_map(|p| p.trim().strip_prefix("rax_session="))
            })
            .filter(|s| uuid::Uuid::parse_str(s).is_ok());
        let mut sessions = self.0.lock().await;
        if let Some(id) = supplied
            && let Some(session) = sessions.get(id)
        {
            return Ok((id.into(), session.clone(), false));
        }
        if sessions.len() >= 256 {
            let mut expired = Vec::new();
            for (key, session) in sessions.iter() {
                if let Ok(s) = session.try_lock()
                    && s.touched.elapsed() > Duration::from_secs(1800)
                    && s.active_ws == 0
                {
                    expired.push(key.clone());
                }
            }
            for key in expired {
                sessions.remove(&key);
            }
            if sessions.len() >= 256 {
                return Err("Session capacity reached".into());
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let session = Arc::new(Mutex::new(Session::new()));
        sessions.insert(id.clone(), session.clone());
        Ok((id, session, true))
    }
}
