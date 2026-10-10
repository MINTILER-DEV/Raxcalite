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
fn safelisted(name: &str, value: &[u8]) -> bool {
    if value.len() > 128 {
        return false;
    }
    let unsafe_byte = |b: u8| (b < 32 && b != 9) || b == 127 || b"\"():<>?@[\\]{}".contains(&b);
    match name {
        "accept" => !value.iter().copied().any(unsafe_byte),
        "accept-language" | "content-language" => value
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || b" *,.-;=".contains(b)),
        "content-type" => {
            !value.iter().copied().any(unsafe_byte)
                && std::str::from_utf8(value).ok().is_some_and(|v| {
                    [
                        "text/plain",
                        "multipart/form-data",
                        "application/x-www-form-urlencoded",
                    ]
                    .contains(
                        &v.split(';')
                            .next()
                            .unwrap_or("")
                            .trim()
                            .to_ascii_lowercase()
                            .as_str(),
                    )
                })
        }
        "range" => std::str::from_utf8(value)
            .ok()
            .and_then(|v| v.strip_prefix("bytes="))
            .and_then(|v| v.split_once('-'))
            .is_some_and(|(start, end)| {
                !start.is_empty()
                    && start.bytes().all(|b| b.is_ascii_digit())
                    && end.bytes().all(|b| b.is_ascii_digit())
                    && (end.is_empty()
                        || start
                            .parse::<u64>()
                            .ok()
                            .zip(end.parse::<u64>().ok())
                            .is_some_and(|(a, b)| a <= b))
            }),
        _ => false,
    }
}
// Reloads and Request.cache can add these after the native API has checked the
// author's header list. Explicit values travel separately so they still preflight.
pub fn authored_headers(outgoing: &HeaderMap, transport: &HeaderMap) -> HeaderMap {
    let mut headers = outgoing.clone();
    for name in ["cache-control", "pragma"] {
        if !transport.contains_key(format!("x-rax-{name}")) {
            headers.remove(name);
        }
    }
    headers
}
pub fn unsafe_headers(headers: &HeaderMap) -> Vec<String> {
    let mut unsafe_names = Vec::new();
    let mut possible = Vec::new();
    let mut bytes = 0;
    for (name, value) in headers {
        let n = name.as_str();
        // Browser-generated headers are not authored CORS request headers.
        if matches!(
            n,
            "referer" | "origin" | "cookie" | "user-agent" | "content-length"
        ) {
            continue;
        }
        if safelisted(n, value.as_bytes()) {
            possible.push(n.to_owned());
            bytes += value.as_bytes().len();
        } else {
            unsafe_names.push(n.to_owned());
        }
    }
    if bytes > 1024 {
        unsafe_names.extend(possible);
    }
    unsafe_names.sort();
    unsafe_names.dedup();
    unsafe_names
}
pub fn preflight_allowed(
    headers: &HeaderMap,
    method: &str,
    names: &[String],
    credentials: bool,
) -> bool {
    let methods = headers
        .get(header::ACCESS_CONTROL_ALLOW_METHODS)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let allowed = headers
        .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let method_ok = ["GET", "HEAD", "POST"].contains(&method)
        || methods
            .split(',')
            .any(|m| m.trim() == method || (!credentials && m.trim() == "*"));
    method_ok
        && names.iter().all(|name| {
            allowed.split(',').any(|v| {
                v.trim() == name || (!credentials && name != "authorization" && v.trim() == "*")
            })
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_cache_headers_do_not_preflight_but_authored_values_do() {
        let mut outgoing = HeaderMap::new();
        outgoing.insert("cache-control", "no-cache".parse().unwrap());
        outgoing.insert("pragma", "no-cache".parse().unwrap());
        outgoing.insert("x-page-header", "value".parse().unwrap());
        let mut transport = HeaderMap::new();
        assert_eq!(
            unsafe_headers(&authored_headers(&outgoing, &transport)),
            vec!["x-page-header"]
        );
        transport.insert("x-rax-cache-control", "no-cache".parse().unwrap());
        transport.insert("x-rax-pragma", "no-cache".parse().unwrap());
        assert_eq!(
            unsafe_headers(&authored_headers(&outgoing, &transport)),
            vec!["cache-control", "pragma", "x-page-header"]
        );
    }
    #[test]
    fn wildcard_does_not_authorize_credentials() {
        let mut headers = HeaderMap::new();
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
        assert!(allowed(&headers, "https://example.com", false));
        assert!(!allowed(&headers, "https://example.com", true));
    }
    #[test]
    fn preflight_safelist_and_wildcards_follow_credentials_and_authorization() {
        let mut headers = HeaderMap::new();
        headers.insert("accept", "text/plain:unsafe".parse().unwrap());
        headers.insert("range", "bytes=5-9".parse().unwrap());
        assert_eq!(unsafe_headers(&headers), vec!["accept"]);
        headers.insert("range", "bytes=-5".parse().unwrap());
        headers.insert("content-type", "TEXT/PLAIN;charset=utf-8".parse().unwrap());
        assert_eq!(unsafe_headers(&headers), vec!["accept", "range"]);
        let mut allowed = HeaderMap::new();
        allowed.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, "*".parse().unwrap());
        allowed.insert(header::ACCESS_CONTROL_ALLOW_METHODS, "*".parse().unwrap());
        assert!(preflight_allowed(
            &allowed,
            "PATCH",
            &["x-fixture".into()],
            false
        ));
        assert!(!preflight_allowed(
            &allowed,
            "PATCH",
            &["x-fixture".into()],
            true
        ));
        assert!(!preflight_allowed(
            &allowed,
            "GET",
            &["authorization".into()],
            false
        ));
        allowed.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            "authorization,x-fixture".parse().unwrap(),
        );
        allowed.remove(header::ACCESS_CONTROL_ALLOW_METHODS);
        assert!(preflight_allowed(
            &allowed,
            "GET",
            &["authorization".into()],
            true
        ));
    }
}
