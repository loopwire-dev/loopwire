use axum::extract::State;
use axum::Json;
use serde::Serialize;
use std::net::IpAddr;

use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_secs: u64,
    pub hostname: String,
    pub os: &'static str,
    pub arch: &'static str,
    pub lan_addresses: Vec<String>,
}

static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

pub fn init_start_time() {
    START_TIME.get_or_init(std::time::Instant::now);
}

fn get_lan_addresses() -> Vec<String> {
    let mut addrs = Vec::new();
    // Use a UDP connect trick to find the primary LAN IP
    if let Ok(local_addr) = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|s| {
        s.connect("8.8.8.8:80")?;
        s.local_addr()
    }) {
        if let IpAddr::V4(ip) = local_addr.ip() {
            if !ip.is_loopback() {
                addrs.push(ip.to_string());
            }
        }
    }
    addrs
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let uptime = START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0);

    let lan_addresses = if state.config.lan.enabled && !state.config.host.is_loopback() {
        get_lan_addresses()
    } else {
        Vec::new()
    };

    let hostname = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_default();

    Json(HealthResponse {
        status: "ok".to_string(),
        version: state.version.to_string(),
        uptime_secs: uptime,
        hostname,
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        lan_addresses,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_response_serialization() {
        let resp = HealthResponse {
            status: "ok".to_string(),
            version: "1.0.0".to_string(),
            uptime_secs: 42,
            hostname: "my-host".to_string(),
            os: "macos",
            arch: "aarch64",
            lan_addresses: vec!["192.168.1.5".to_string()],
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["version"], "1.0.0");
        assert_eq!(json["uptime_secs"], 42);
        assert_eq!(json["hostname"], "my-host");
        assert_eq!(json["os"], "macos");
        assert_eq!(json["arch"], "aarch64");
        assert_eq!(json["lan_addresses"][0], "192.168.1.5");
    }

    #[test]
    fn get_lan_addresses_returns_non_loopback() {
        let addrs = get_lan_addresses();
        for addr in &addrs {
            let ip: std::net::Ipv4Addr = addr.parse().unwrap();
            assert!(!ip.is_loopback());
        }
    }
}
