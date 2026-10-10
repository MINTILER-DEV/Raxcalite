use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use url::Url;

pub fn decode(path: &str, query: Option<&str>) -> Result<Url, String> {
    let tail = path
        .strip_prefix("/p/")
        .or_else(|| path.strip_prefix("/ws/"))
        .ok_or("Invalid proxy route")?;
    let (token, rest) = tail.split_once('/').unwrap_or((tail, ""));
    let bytes = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|_| "Invalid origin token")?;
    let origin = String::from_utf8(bytes).map_err(|_| "Invalid UTF-8 origin")?;
    let parsed = Url::parse(&origin).map_err(|_| "Invalid origin")?;
    if parsed.origin().ascii_serialization() != origin {
        return Err("Noncanonical origin".into());
    }
    let mut url = Url::parse(&format!("{origin}/{rest}")).map_err(|_| "Invalid upstream URL")?;
    url.set_query(query);
    Ok(url)
}
pub fn encode(url: &Url) -> String {
    let prefix = if matches!(url.scheme(), "ws" | "wss") {
        "ws"
    } else {
        "p"
    };
    let origin = URL_SAFE_NO_PAD.encode(url.origin().ascii_serialization());
    format!(
        "/{prefix}/{origin}{}{}{}",
        url.path(),
        url.query().map(|q| format!("?{q}")).unwrap_or_default(),
        url.fragment().map(|f| format!("#{f}")).unwrap_or_default()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip() {
        for value in [
            "https://example.com/a%20b?q=%2F",
            "http://example.com:8080/",
            "https://xn--bcher-kva.de/a",
        ] {
            let url = Url::parse(value).unwrap();
            let encoded = encode(&url);
            let (path, query) = encoded
                .split_once('?')
                .map(|(p, q)| (p, Some(q)))
                .unwrap_or((&encoded, None));
            assert_eq!(decode(path, query).unwrap(), url);
        }
    }
}
