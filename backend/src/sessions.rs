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
pub struct Sessions(
    Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>,
    Option<Arc<Persistence>>,
);
struct Persistence {
    path: std::path::PathBuf,
    cipher: aes_gcm::Aes256Gcm,
}
#[derive(serde::Serialize, serde::Deserialize)]
struct Record {
    id: String,
    expires: u64,
    cookies: CookieStore,
}
fn epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

impl Sessions {
    pub fn load() -> Result<Self, String> {
        let path = std::env::var("RAX_SESSION_FILE").ok();
        let key = std::env::var("RAX_SESSION_KEY").ok();
        match (path, key) {
            (None, None) => Ok(Self::default()),
            (Some(path), Some(key)) => {
                use base64::Engine;
                let key = base64::engine::general_purpose::STANDARD
                    .decode(key)
                    .map_err(|_| "Invalid session encryption key")?;
                Self::from_file(path.into(), &key)
            }
            _ => Err("RAX_SESSION_FILE and RAX_SESSION_KEY must be set together".into()),
        }
    }
    fn from_file(path: std::path::PathBuf, key: &[u8]) -> Result<Self, String> {
        use aes_gcm::{KeyInit, aead::Aead};
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(key)
            .map_err(|_| "Session key must decode to 32 bytes")?;
        let mut sessions = HashMap::new();
        if path.exists() {
            if std::fs::metadata(&path)
                .map_err(|_| "Cannot inspect session file")?
                .len()
                > 4 * 1024 * 1024
            {
                return Err("Session file exceeds limit".into());
            }
            let bytes = std::fs::read(&path).map_err(|_| "Cannot read session file")?;
            if bytes.len() < 28 {
                return Err("Invalid encrypted session file".into());
            }
            let plaintext = cipher
                .decrypt(
                    aes_gcm::Nonce::from_slice(&bytes[..12]),
                    bytes[12..].as_ref(),
                )
                .map_err(|_| "Session authentication failed")?;
            let records: Vec<Record> =
                serde_json::from_slice(&plaintext).map_err(|_| "Invalid session records")?;
            for record in records
                .into_iter()
                .filter(|r| r.expires > epoch())
                .take(256)
            {
                if uuid::Uuid::parse_str(&record.id).is_err() {
                    continue;
                }
                let remaining = record.expires.saturating_sub(epoch()).min(1800);
                let mut session = Session::new();
                session.cookies = record.cookies;
                session.touched = Instant::now() - Duration::from_secs(1800 - remaining);
                sessions.insert(record.id, Arc::new(Mutex::new(session)));
            }
        }
        Ok(Self(
            Arc::new(Mutex::new(sessions)),
            Some(Arc::new(Persistence { path, cipher })),
        ))
    }
    pub async fn maintain(&self) {
        let mut sessions = self.0.lock().await;
        sessions.retain(|_, session| {
            session
                .try_lock()
                .map(|s| s.touched.elapsed() <= Duration::from_secs(1800) || s.active_ws > 0)
                .unwrap_or(true)
        });
    }
    pub async fn persist(&self) -> Result<(), String> {
        use aes_gcm::{
            AeadCore,
            aead::{Aead, OsRng},
        };
        let Some(store) = &self.1 else {
            return Ok(());
        };
        let sessions = self.0.lock().await;
        let mut records = Vec::new();
        for (id, session) in sessions.iter() {
            let s = session.lock().await;
            if s.touched.elapsed().as_secs() < 1800 {
                records.push(Record {
                    id: id.clone(),
                    expires: epoch() + 1800 - s.touched.elapsed().as_secs(),
                    cookies: s.cookies.clone(),
                });
            }
        }
        drop(sessions);
        let plaintext = serde_json::to_vec(&records).map_err(|_| "Session serialization failed")?;
        let nonce = aes_gcm::Aes256Gcm::generate_nonce(&mut OsRng);
        let encrypted = store
            .cipher
            .encrypt(&nonce, plaintext.as_ref())
            .map_err(|_| "Session encryption failed")?;
        let mut bytes = nonce.to_vec();
        bytes.extend_from_slice(&encrypted);
        let temporary = store.path.with_extension("pending");
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);
        use tokio::io::AsyncWriteExt;
        let mut file = options
            .open(&temporary)
            .await
            .map_err(|_| "Cannot write encrypted sessions")?;
        file.write_all(&bytes)
            .await
            .map_err(|_| "Cannot write encrypted sessions")?;
        file.sync_all()
            .await
            .map_err(|_| "Cannot sync encrypted sessions")?;
        drop(file);
        tokio::fs::rename(temporary, &store.path)
            .await
            .map_err(|_| "Cannot replace encrypted session file")?;
        Ok(())
    }

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
            let mut existing = session.lock().await;
            if existing.touched.elapsed() <= Duration::from_secs(1800) || existing.active_ws > 0 {
                existing.touched = Instant::now();
                return Ok((id.into(), session.clone(), false));
            }
            drop(existing);
            sessions.remove(id);
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

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn persistence_authentication_expiration_and_rate_limits() {
        let path = std::env::temp_dir().join(format!("rax-session-{}.enc", uuid::Uuid::new_v4()));
        let sessions = Sessions::from_file(path.clone(), &[42; 32]).unwrap();
        let (id, session, _) = sessions.get(&HeaderMap::new()).await.unwrap();
        session
            .lock()
            .await
            .cookies
            .parse(
                "secret=value; HttpOnly; Max-Age=3600",
                &url::Url::parse("https://example.com/").unwrap(),
            )
            .unwrap();
        sessions.persist().await.unwrap();
        assert!(!String::from_utf8_lossy(&std::fs::read(&path).unwrap()).contains("secret"));
        assert!(Sessions::from_file(path.clone(), &[43; 32]).is_err());
        let restored = Sessions::from_file(path.clone(), &[42; 32]).unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("cookie", format!("rax_session={id}").parse().unwrap());
        assert_eq!(
            restored
                .get(&headers)
                .await
                .unwrap()
                .1
                .lock()
                .await
                .cookies
                .iter_unexpired()
                .count(),
            1
        );
        session.lock().await.touched = Instant::now() - Duration::from_secs(1801);
        assert_ne!(sessions.get(&headers).await.unwrap().0, id);
        let mut limited = Session::new();
        for _ in 0..600 {
            assert!(limited.allow());
        }
        assert!(!limited.allow());
        std::fs::remove_file(path).unwrap();
    }
}
