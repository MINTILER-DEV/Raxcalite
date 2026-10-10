use axum::http::{HeaderMap, header};

pub fn allowed(headers: &HeaderMap, origin: &str, credentials: bool) -> bool {
    let allowed = headers
        .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
        .and_then(|v| v.to_str().ok());
    let origin_ok = allowed == Some(origin) || (!credentials && allowed == Some("*"));
    origin_ok
        && (!credentials
            || headers
                .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
                .and_then(|v| v.to_str().ok())
                == Some("true"))
}
pub fn unsafe_headers(headers: &HeaderMap) -> Vec<String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let n = name.as_str();
            if matches!(
                n,
                "accept"
                    | "accept-language"
                    | "content-language"
                    | "referer"
                    | "origin"
                    | "cookie"
                    | "user-agent"
                    | "content-length"
            ) {
                return None;
            }
            if n == "content-type"
                && value.to_str().ok().is_some_and(|v| {
                    [
                        "text/plain",
                        "multipart/form-data",
                        "application/x-www-form-urlencoded",
                    ]
                    .contains(&v.split(';').next().unwrap_or("").trim())
                })
            {
                return None;
            }
            Some(n.to_owned())
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wildcard_does_not_authorize_credentials() {
        let mut headers = HeaderMap::new();
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
        assert!(allowed(&headers, "https://example.com", false));
        assert!(!allowed(&headers, "https://example.com", true));
    }
}
