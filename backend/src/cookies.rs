use cookie_store::{Cookie, CookieDomain, CookieStore};
use url::Url;

pub fn validate(raw: &str, url: &Url, script: bool, jar: &CookieStore) -> Result<(), &'static str> {
    if raw.len() > 4096 {
        return Err("Cookie input exceeds 4 KiB");
    }
    let candidate = Cookie::parse(raw, url).map_err(|_| "Invalid cookie attributes")?;
    if script && candidate.http_only() == Some(true) {
        return Err("Scripts cannot create HttpOnly cookies");
    }
    if let CookieDomain::Suffix(domain) = &candidate.domain
        && psl::domain(domain.as_bytes()).is_none()
    {
        return Err("Public-suffix cookies are blocked");
    }
    let secure = candidate.secure() == Some(true);
    if secure && url.scheme() != "https" {
        return Err("Secure cookies require HTTPS");
    }
    if candidate
        .same_site()
        .is_some_and(|s| format!("{s:?}") == "None")
        && !secure
    {
        return Err("SameSite=None requires Secure");
    }
    if candidate.name().starts_with("__Secure-") && !secure {
        return Err("__Secure- cookies require Secure");
    }
    if candidate.name().starts_with("__Host-")
        && (!secure || candidate.path.as_ref() != "/" || candidate.domain().is_some())
    {
        return Err("Invalid __Host- cookie attributes");
    }
    if script
        && jar.iter_any().any(|c| {
            c.name() == candidate.name()
                && c.domain.as_cow() == candidate.domain.as_cow()
                && c.path == candidate.path
                && c.http_only() == Some(true)
                && !c.is_expired()
        })
    {
        return Err("HttpOnly cookie is protected");
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_public_suffix_and_http_only_path_overwrites() {
        let url = Url::parse("https://a.example.co.uk/page").unwrap();
        let mut jar = CookieStore::default();
        assert!(validate("leak=x; Domain=co.uk", &url, false, &jar).is_err());
        assert!(validate("safe=x; Domain=example.co.uk", &url, false, &jar).is_ok());
        jar.parse("secret=x; Path=/protected; HttpOnly", &url)
            .unwrap();
        assert!(validate("secret=hacked; Path=/protected", &url, true, &jar).is_err());
        assert!(validate("created=x; HttpOnly=true", &url, true, &jar).is_err());
        assert!(
            validate(
                "__Host-bad=x; Secure; Domain=example.co.uk; Path=/",
                &url,
                false,
                &jar
            )
            .is_err()
        );
    }
}
