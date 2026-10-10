use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use url::Url;

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_multicast()
                || a == 0
                || a >= 240
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0)
                || (a == 192 && b == 168)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(v4));
            }
            // Only globally routable unicast; deny documentation ranges and transition tunnels.
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] == 0 || s[1] == 0xdb8 || s[1] < 0x200))
        }
    }
}
pub fn validate_url(url: &Url, fixtures: &[String]) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https" | "ws" | "wss") {
        return Err("Unsupported upstream protocol".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Credentials in URLs are rejected".into());
    }
    let host = url.host_str().ok_or("Missing upstream host")?;
    if fixtures.iter().any(|v| v == host) {
        return Ok(());
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>()
        && !public_ip(ip)
    {
        return Err("Private and reserved destinations are blocked".into());
    }
    let port = url.port_or_known_default().ok_or("Missing port")?;
    if ![80, 443].contains(&port) {
        return Err("Only upstream ports 80 and 443 are allowed".into());
    }
    Ok(())
}
#[derive(Clone)]
pub struct SafeResolver {
    pub fixtures: Arc<Vec<String>>,
}
fn validated_addresses(
    addresses: Vec<SocketAddr>,
    fixture: bool,
) -> Result<Vec<SocketAddr>, std::io::Error> {
    if addresses.is_empty() || (!fixture && addresses.iter().any(|a| !public_ip(a.ip()))) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Unsafe DNS destination",
        ));
    }
    Ok(addresses)
}
impl Resolve for SafeResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        let fixtures = self.fixtures.clone();
        Box::pin(async move {
            let addresses: Vec<SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            let addresses = validated_addresses(addresses, fixtures.contains(&host))?;
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}
pub async fn resolve_socket(url: &Url, fixtures: &[String]) -> Result<Vec<SocketAddr>, String> {
    validate_url(url, fixtures)?;
    let host = url.host_str().unwrap().trim_matches(['[', ']']);
    let addresses: Vec<_> = tokio::net::lookup_host((host, url.port_or_known_default().unwrap()))
        .await
        .map_err(|_| "DNS resolution failed")?
        .collect();
    validated_addresses(addresses, fixtures.iter().any(|v| v == host))
        .map_err(|_| "Unsafe DNS destination".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_answers_and_rebound_lookups_fail_closed() {
        let public = "1.1.1.1:443".parse().unwrap();
        let private = "127.0.0.1:443".parse().unwrap();
        assert!(validated_addresses(vec![public], false).is_ok());
        assert!(validated_addresses(vec![public, private], false).is_err());
        assert!(validated_addresses(vec![private], false).is_err());
        assert!(validated_addresses(vec![], false).is_err());
        assert!(validated_addresses(vec![private], true).is_ok());
        for url in [
            "http://example.com:8080/",
            "http://user:password@example.com/",
            "file:///etc/passwd",
        ] {
            assert!(validate_url(&Url::parse(url).unwrap(), &[]).is_err());
        }
    }
    #[test]
    fn blocks_private_and_reserved() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
            "2002:7f00:1::",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("1.1.1.1".parse().unwrap()));
    }
}
