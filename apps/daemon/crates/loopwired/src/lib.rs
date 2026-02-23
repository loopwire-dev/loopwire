//! Shared helpers and response types used by the `loopwired` daemon binary.

use mdns_sd::{ServiceDaemon, ServiceInfo};
use serde::Deserialize;
use std::fs;
use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;

/// Build-time daemon version string.
///
/// When `LOOPWIRED_VERSION` is provided in the build environment (for example
/// by CI release workflows), that value is used. Otherwise we fall back to the
/// crate package version.
pub const DAEMON_VERSION: &str = match option_env!("LOOPWIRED_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

// ---------------------------------------------------------------------------
// PID file management
// ---------------------------------------------------------------------------

/// Reads the daemon PID from `path`, returning `None` if missing or invalid.
pub fn read_pid_file(path: &Path) -> Option<u32> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

/// Writes the current process PID to `path`.
pub fn write_pid_file(path: &Path) -> anyhow::Result<()> {
    fs::write(path, std::process::id().to_string())?;
    Ok(())
}

/// Removes the PID file at `path` if it exists.
pub fn remove_pid_file(path: &Path) {
    let _ = fs::remove_file(path);
}

/// Returns `true` when a process with `pid` appears to be alive.
pub fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/// Returns detected local IPv4 LAN addresses for daemon advertisement.
pub fn get_lan_addresses() -> Vec<Ipv4Addr> {
    let mut addrs = Vec::new();
    if let Ok(local) = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|s| {
        s.connect("8.8.8.8:80")?;
        s.local_addr()
    }) {
        if let IpAddr::V4(ip) = local.ip() {
            if !ip.is_loopback() {
                addrs.push(ip);
            }
        }
    }
    addrs
}

/// Registers the Loopwire daemon service over mDNS on `port`.
pub fn register_mdns(port: u16) -> anyhow::Result<ServiceDaemon> {
    let mdns = ServiceDaemon::new()?;
    let host = hostname::get()
        .unwrap_or_else(|_| "loopwire-host".into())
        .to_string_lossy()
        .to_string();

    let host_label = host.trim_end_matches(".local").to_string();

    let lan_ips = get_lan_addresses();
    let ip_strings: Vec<String> = lan_ips.iter().map(|ip| ip.to_string()).collect();

    let service_hostname = format!("{}.local.", host_label);
    let ip_strs: Vec<&str> = ip_strings.iter().map(|s| s.as_str()).collect();
    let service = ServiceInfo::new(
        "_loopwire._tcp.local.",
        &host_label,
        &service_hostname,
        ip_strs.as_slice(),
        port,
        None,
    )?;

    mdns.register(service)?;

    tracing::info!(
        "mDNS: registered _loopwire._tcp as {} on port {} (IPs: {})",
        host_label,
        port,
        ip_strings.join(", ")
    );

    Ok(mdns)
}

// ---------------------------------------------------------------------------
// Share API response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, PartialEq)]
/// Response payload returned when starting a remote-share session.
pub struct ShareStartResponse {
    /// Public URL used by clients to connect.
    pub connect_url: String,
    /// Public backend base URL for API access.
    pub public_backend_url: String,
    /// RFC3339 expiration timestamp for this share.
    pub expires_at: String,
    /// Indicates whether PIN verification is required.
    pub pin_required: bool,
    /// Active remote provider identifier.
    pub provider: String,
}

#[derive(Debug, Deserialize, PartialEq)]
/// Response payload describing current remote-share status.
pub struct ShareStatusResponse {
    /// Whether remote sharing is currently active.
    pub active: bool,
    /// Active provider identifier when sharing is enabled.
    pub provider: Option<String>,
    /// Public backend URL when sharing is enabled.
    pub public_backend_url: Option<String>,
    /// Connect URL when sharing is enabled.
    pub connect_url: Option<String>,
    /// RFC3339 expiration timestamp when sharing is enabled.
    pub expires_at: Option<String>,
    /// Indicates whether PIN verification is required.
    pub pin_required: bool,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    // -- PID file management -----------------------------------------------

    #[test]
    fn read_pid_file_valid() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.pid");
        fs::write(&path, "12345").unwrap();
        assert_eq!(read_pid_file(&path), Some(12345));
    }

    #[test]
    fn read_pid_file_with_trailing_newline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.pid");
        fs::write(&path, "99999\n").unwrap();
        assert_eq!(read_pid_file(&path), Some(99999));
    }

    #[test]
    fn read_pid_file_with_whitespace() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.pid");
        fs::write(&path, "  42  \n").unwrap();
        assert_eq!(read_pid_file(&path), Some(42));
    }

    #[test]
    fn read_pid_file_nonexistent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.pid");
        assert_eq!(read_pid_file(&path), None);
    }

    #[test]
    fn read_pid_file_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.pid");
        fs::write(&path, "").unwrap();
        assert_eq!(read_pid_file(&path), None);
    }

    #[test]
    fn read_pid_file_garbage() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("garbage.pid");
        fs::write(&path, "not-a-number").unwrap();
        assert_eq!(read_pid_file(&path), None);
    }

    #[test]
    fn read_pid_file_negative() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("neg.pid");
        fs::write(&path, "-1").unwrap();
        assert_eq!(read_pid_file(&path), None);
    }

    #[test]
    fn read_pid_file_float() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("float.pid");
        fs::write(&path, "3.14").unwrap();
        assert_eq!(read_pid_file(&path), None);
    }

    #[test]
    fn read_pid_file_overflow() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.pid");
        fs::write(&path, "99999999999999999").unwrap();
        assert_eq!(read_pid_file(&path), None);
    }

    #[test]
    fn write_pid_file_creates_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.pid");
        write_pid_file(&path).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        let pid: u32 = content.trim().parse().unwrap();
        assert_eq!(pid, std::process::id());
    }

    #[test]
    fn write_pid_file_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.pid");
        fs::write(&path, "99999").unwrap();
        write_pid_file(&path).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        let pid: u32 = content.trim().parse().unwrap();
        assert_eq!(pid, std::process::id());
    }

    #[test]
    fn write_pid_file_bad_path_fails() {
        let result = write_pid_file(Path::new("/nonexistent/dir/test.pid"));
        assert!(result.is_err());
    }

    #[test]
    fn remove_pid_file_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.pid");
        fs::write(&path, "12345").unwrap();
        assert!(path.exists());
        remove_pid_file(&path);
        assert!(!path.exists());
    }

    #[test]
    fn remove_pid_file_nonexistent_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nope.pid");
        remove_pid_file(&path); // should not panic
    }

    #[test]
    fn write_then_read_pid_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.pid");
        write_pid_file(&path).unwrap();
        let pid = read_pid_file(&path).unwrap();
        assert_eq!(pid, std::process::id());
    }

    #[test]
    fn write_read_remove_lifecycle() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.pid");
        assert_eq!(read_pid_file(&path), None);
        write_pid_file(&path).unwrap();
        assert!(read_pid_file(&path).is_some());
        remove_pid_file(&path);
        assert_eq!(read_pid_file(&path), None);
    }

    // -- is_process_alive --------------------------------------------------

    #[test]
    fn is_process_alive_self() {
        assert!(is_process_alive(std::process::id()));
    }

    #[test]
    fn is_process_alive_parent() {
        // Parent process should always be alive while we're running
        let ppid = unsafe { libc::getppid() } as u32;
        assert!(is_process_alive(ppid));
    }

    #[test]
    fn is_process_alive_nonexistent() {
        // Very high PID, almost certainly not running
        assert!(!is_process_alive(4_000_000_000));
    }

    // -- get_lan_addresses -------------------------------------------------

    #[test]
    fn get_lan_addresses_returns_non_loopback() {
        let addrs = get_lan_addresses();
        for addr in &addrs {
            assert!(!addr.is_loopback(), "LAN address should not be loopback");
        }
    }

    #[test]
    fn get_lan_addresses_returns_valid_ipv4() {
        let addrs = get_lan_addresses();
        // We can't assert the list is non-empty (CI may not have network),
        // but every returned address should be valid IPv4
        for addr in &addrs {
            assert!(!addr.is_broadcast());
            assert!(!addr.is_unspecified());
        }
    }

    // -- ShareStartResponse ------------------------------------------------

    #[test]
    fn share_start_response_deserialize() {
        let json = serde_json::json!({
            "connect_url": "https://example.com/connect?token=abc",
            "public_backend_url": "https://tunnel.example.com",
            "expires_at": "2026-01-01T00:00:00Z",
            "pin_required": true,
            "provider": "cloudflared"
        });
        let resp: ShareStartResponse = serde_json::from_value(json).unwrap();
        assert_eq!(resp.connect_url, "https://example.com/connect?token=abc");
        assert_eq!(resp.public_backend_url, "https://tunnel.example.com");
        assert_eq!(resp.expires_at, "2026-01-01T00:00:00Z");
        assert!(resp.pin_required);
        assert_eq!(resp.provider, "cloudflared");
    }

    #[test]
    fn share_start_response_missing_field_fails() {
        let json = serde_json::json!({
            "connect_url": "https://example.com",
            "public_backend_url": "https://tunnel.example.com",
            // missing expires_at, pin_required, provider
        });
        let result = serde_json::from_value::<ShareStartResponse>(json);
        assert!(result.is_err());
    }

    #[test]
    fn share_start_response_pin_false() {
        let json = serde_json::json!({
            "connect_url": "url",
            "public_backend_url": "url",
            "expires_at": "time",
            "pin_required": false,
            "provider": "localhost_run"
        });
        let resp: ShareStartResponse = serde_json::from_value(json).unwrap();
        assert!(!resp.pin_required);
        assert_eq!(resp.provider, "localhost_run");
    }

    // -- ShareStatusResponse -----------------------------------------------

    #[test]
    fn share_status_response_active() {
        let json = serde_json::json!({
            "active": true,
            "provider": "cloudflared",
            "public_backend_url": "https://tunnel.example.com",
            "connect_url": "https://example.com/connect",
            "expires_at": "2026-01-01T00:00:00Z",
            "pin_required": true
        });
        let resp: ShareStatusResponse = serde_json::from_value(json).unwrap();
        assert!(resp.active);
        assert_eq!(resp.provider.as_deref(), Some("cloudflared"));
        assert!(resp.public_backend_url.is_some());
        assert!(resp.connect_url.is_some());
        assert!(resp.expires_at.is_some());
        assert!(resp.pin_required);
    }

    #[test]
    fn share_status_response_inactive() {
        let json = serde_json::json!({
            "active": false,
            "provider": null,
            "public_backend_url": null,
            "connect_url": null,
            "expires_at": null,
            "pin_required": false
        });
        let resp: ShareStatusResponse = serde_json::from_value(json).unwrap();
        assert!(!resp.active);
        assert!(resp.provider.is_none());
        assert!(resp.public_backend_url.is_none());
        assert!(resp.connect_url.is_none());
        assert!(resp.expires_at.is_none());
        assert!(!resp.pin_required);
    }

    #[test]
    fn share_status_response_missing_optional_fields() {
        let json = serde_json::json!({
            "active": false,
            "pin_required": false
        });
        let resp: ShareStatusResponse = serde_json::from_value(json).unwrap();
        assert!(!resp.active);
        assert!(resp.provider.is_none());
    }

    #[test]
    fn share_status_response_missing_required_field_fails() {
        let json = serde_json::json!({
            // missing "active" and "pin_required"
            "provider": "test"
        });
        let result = serde_json::from_value::<ShareStatusResponse>(json);
        assert!(result.is_err());
    }

    // -- register_mdns (smoke test) ----------------------------------------

    #[test]
    fn register_mdns_succeeds() {
        let result = register_mdns(19999);
        // Should succeed on most systems; if mDNS is unavailable, we skip
        if let Ok(daemon) = result {
            let _ = daemon.shutdown();
        }
    }
}
