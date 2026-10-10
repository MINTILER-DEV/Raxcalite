use cookie_store::{Cookie, CookieDomain, CookieStore};
use url::Url;

pub fn same_site(a: &Url, b: &Url) -> bool {
    let site = |url: &Url| {
        let host = url.host_str().unwrap_or("");
        psl::domain(host.as_bytes())
            .map(|d| String::from_utf8_lossy(d.as_bytes()).into_owned())
            .unwrap_or_else(|| host.to_owned())
    };
    a.scheme() == b.scheme() && site(a) == site(b)
}
pub fn permitted(
    cookie: &Cookie<'_>,
    source: Option<&Url>,
    target: &Url,
    top_navigation: bool,
    safe_method: bool,
) -> bool {
    if source.is_none_or(|s| same_site(s, target)) {
        return true;
    }
    match cookie.same_site().map(|s| format!("{s:?}")).as_deref() {
        Some("None") => true,
        Some("Strict") => false,
        _ => top_navigation && safe_method,
    }
}

// Discard expired entries, permit replacements at capacity, and evict a bounded
// deterministic entry rather than permanently freezing a full jar.
pub fn insert(
    jar: &mut CookieStore,
    raw: &str,
    url: &Url,
    script: bool,
) -> Result<bool, &'static str> {
    validate(raw, url, script, jar)?;
    let expired: Vec<_> = jar
        .iter_any()
        .filter(|c| c.is_expired())
        .map(|c| {
            (
                c.domain.as_cow().unwrap_or_default().into_owned(),
                c.path.as_ref().to_owned(),
                c.name().to_owned(),
            )
        })
        .collect();
    for (domain, path, name) in expired {
        jar.remove(&domain, &path, &name);
    }
    let candidate = Cookie::parse(raw, url).map_err(|_| "Invalid cookie")?;
    // Native cookie deletion is a successful no-op when the entry is absent.
    // cookie_store::parse otherwise reports an already-expired insertion error.
    if candidate.is_expired() {
        jar.remove(
            &candidate.domain.as_cow().unwrap_or_default(),
            candidate.path.as_ref(),
            candidate.name(),
        );
        return Ok(false);
    }
    let exists = jar.iter_any().any(|c| {
        c.name() == candidate.name() && c.path == candidate.path && c.domain == candidate.domain
    });
    let mut evicted = false;
    if !exists && !candidate.is_expired() && jar.iter_unexpired().count() >= 128 {
        let victim = jar
            .iter_unexpired()
            .min_by_key(|c| {
                format!(
                    "{}:{}:{}",
                    c.domain.as_cow().unwrap_or_default(),
                    c.path.as_ref(),
                    c.name()
                )
            })
            .map(|c| {
                (
                    c.domain.as_cow().unwrap_or_default().into_owned(),
                    c.path.as_ref().to_owned(),
                    c.name().to_owned(),
                )
            });
        if let Some((domain, path, name)) = victim {
            jar.remove(&domain, &path, &name);
            evicted = true;
        }
    }
    jar.parse(raw, url)
        .map_err(|_| "Invalid cookie attributes")?;
    Ok(evicted)
}

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
    fn schemeful_site_and_lax_top_navigation() {
        let target = Url::parse("https://a.example.co.uk/path").unwrap();
        let same = Url::parse("https://b.example.co.uk:8443/").unwrap();
        let cross = Url::parse("http://a.example.co.uk/").unwrap();
        assert!(same_site(&same, &target));
        assert!(!same_site(&cross, &target));
        let lax = Cookie::parse("lax=x; SameSite=Lax", &target).unwrap();
        assert!(!permitted(&lax, Some(&cross), &target, false, true));
        assert!(permitted(&lax, Some(&cross), &target, true, true));
        assert!(!permitted(&lax, Some(&cross), &target, true, false));
    }
    #[test]
    fn full_jar_replacements_deletions_and_eviction() {
        let url = Url::parse("https://example.com/").unwrap();
        let mut jar = CookieStore::default();
        for i in 0..128 {
            insert(&mut jar, &format!("k{i}=v; Path=/"), &url, false).unwrap();
        }
        assert!(!insert(&mut jar, "k1=new; Path=/", &url, false).unwrap());
        assert!(insert(&mut jar, "extra=v; Path=/", &url, false).unwrap());
        assert_eq!(jar.iter_unexpired().count(), 128);
        insert(&mut jar, "extra=; Max-Age=0; Path=/", &url, false).unwrap();
        assert_eq!(jar.iter_unexpired().count(), 127);
    }
    #[test]
    fn expired_cookie_deletion_is_idempotent_for_existing_and_absent_entries() {
        let url = Url::parse("https://www.example.com/").unwrap();
        let mut jar = CookieStore::default();
        let expired = "remote=; Domain=example.com; Path=/; Expires=Sun, 01 Feb 1970 06:00:00 GMT";
        assert!(!insert(&mut jar, expired, &url, true).unwrap());
        insert(
            &mut jar,
            "remote=present; Domain=example.com; Path=/",
            &url,
            true,
        )
        .unwrap();
        assert_eq!(jar.iter_unexpired().count(), 1);
        assert!(!insert(&mut jar, expired, &url, true).unwrap());
        assert_eq!(jar.iter_unexpired().count(), 0);
        assert!(!insert(&mut jar, expired, &url, true).unwrap());
    }
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
