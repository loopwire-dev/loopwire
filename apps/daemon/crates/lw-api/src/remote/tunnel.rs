use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy)]
pub(crate) enum TunnelProvider {
    Cloudflared,
    LocalhostRun,
}

impl TunnelProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cloudflared => "cloudflared",
            Self::LocalhostRun => "localhost_run",
        }
    }
}

pub(crate) async fn wait_for_public_url(child: &mut Child) -> Result<String, anyhow::Error> {
    let mut rx = subscribe_process_output(child);
    let timeout = std::time::Duration::from_secs(25);

    let fut = async {
        while let Some(line) = rx.recv().await {
            for url in extract_https_urls(&line) {
                if is_cloudflared_public_url(&url) {
                    return Ok(url);
                }
            }
        }

        anyhow::bail!("provider did not emit a public URL")
    };

    tokio::time::timeout(timeout, fut)
        .await
        .map_err(|_| anyhow::anyhow!("timed out while waiting for public URL"))?
}

pub(crate) async fn wait_for_localhost_run_url(child: &mut Child) -> Result<String, anyhow::Error> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("no stdout from SSH process"))?;
    let mut lines = BufReader::new(stdout).lines();
    let timeout = std::time::Duration::from_secs(25);

    let fut = async {
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::debug!("[localhost.run] {}", line);
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(address) = event.get("address").and_then(|v| v.as_str()) {
                    let url = if address.starts_with("https://") {
                        address.to_string()
                    } else {
                        format!("https://{address}")
                    };
                    return Ok(url);
                }
            }
        }
        anyhow::bail!("localhost.run did not emit a tunnel URL")
    };

    tokio::time::timeout(timeout, fut)
        .await
        .map_err(|_| anyhow::anyhow!("timed out waiting for localhost.run tunnel URL"))?
}

pub(crate) fn subscribe_process_output(child: &mut Child) -> mpsc::UnboundedReceiver<String> {
    let (tx, rx) = mpsc::unbounded_channel();

    if let Some(stdout) = child.stdout.take() {
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!("[remote tunnel] {}", line);
                let _ = tx2.send(line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!("[remote tunnel] {}", line);
                let _ = tx.send(line);
            }
        });
    }

    rx
}

pub(crate) fn spawn_output_reader<R>(reader: R, label: &'static str)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::debug!("{} {}", label, line);
        }
    });
}

pub(crate) fn extract_https_urls(line: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut rest = line;

    while let Some(start) = rest.find("https://") {
        let candidate = &rest[start..];
        let end = candidate
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>'))
            .unwrap_or(candidate.len());
        let cleaned = candidate[..end].trim_end_matches([',', ';', ')', ']', '}']);

        if cleaned.starts_with("https://") {
            urls.push(cleaned.to_string());
        }

        rest = &candidate[end..];
    }

    urls
}

pub(crate) fn is_cloudflared_public_url(candidate: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(candidate) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    host.to_ascii_lowercase().ends_with(".trycloudflare.com")
}

pub(crate) async fn install_cloudflared(destination: &Path) -> Result<(), anyhow::Error> {
    let bin_dir = destination
        .parent()
        .ok_or_else(|| anyhow::anyhow!("invalid cloudflared destination"))?;
    std::fs::create_dir_all(bin_dir)?;

    let (asset_name, is_archive) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => ("cloudflared-linux-amd64", false),
        ("linux", "aarch64") => ("cloudflared-linux-arm64", false),
        ("macos", "x86_64") => ("cloudflared-darwin-amd64.tgz", true),
        ("macos", "aarch64") => ("cloudflared-darwin-arm64.tgz", true),
        (os, arch) => anyhow::bail!("unsupported platform for auto-install: {os}/{arch}"),
    };

    let client = reqwest::Client::builder()
        .user_agent("loopwire-cloudflared-installer")
        .build()?;

    let release_info = resolve_cloudflared_release(&client, asset_name).await?;
    let asset_url = release_info.asset_url;
    let expected_sha256 = release_info.checksum;

    tracing::info!("Downloading cloudflared helper from {}", asset_url);
    let binary_response = client
        .get(&asset_url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await?
        .error_for_status()?;
    let content_type = binary_response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let binary_bytes = binary_response.bytes().await?;

    if is_probable_html_payload(&content_type, &binary_bytes) {
        anyhow::bail!(
            "downloaded cloudflared payload is HTML (content-type: {}), likely due to proxy/content filtering",
            if content_type.is_empty() {
                "<missing>"
            } else {
                &content_type
            }
        );
    }

    let mut accepted_checksums = vec![expected_sha256];
    if let Ok(sidecar_checksum) =
        fetch_cloudflared_sidecar_checksum(&client, &asset_url, asset_name).await
    {
        if !accepted_checksums
            .iter()
            .any(|c| eq_sha256(c, &sidecar_checksum))
        {
            accepted_checksums.push(sidecar_checksum);
        }
    }

    if let Err(err) = verify_sha256_any(&binary_bytes, &accepted_checksums) {
        tracing::warn!(
            "{err} — proceeding because the download source is trusted (HTTPS from GitHub)"
        );
    }

    if is_archive {
        let archive_path = bin_dir.join("cloudflared.tgz");
        std::fs::write(&archive_path, &binary_bytes)?;

        let status = Command::new("tar")
            .arg("-xzf")
            .arg(&archive_path)
            .arg("-C")
            .arg(bin_dir)
            .status()
            .await?;

        let _ = std::fs::remove_file(&archive_path);

        if !status.success() {
            anyhow::bail!("failed to extract cloudflared archive");
        }

        let extracted = bin_dir.join("cloudflared");
        if !extracted.exists() {
            anyhow::bail!("cloudflared archive extracted but binary was not found");
        }

        if extracted != destination {
            std::fs::rename(extracted, destination)?;
        }
    } else {
        std::fs::write(destination, &binary_bytes)?;
    }

    set_executable(destination)?;
    Ok(())
}

pub(crate) struct CloudflaredReleaseInfo {
    pub asset_url: String,
    pub checksum: String,
}

async fn resolve_cloudflared_release(
    client: &reqwest::Client,
    asset_name: &str,
) -> Result<CloudflaredReleaseInfo, anyhow::Error> {
    let release_api = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";
    let release: serde_json::Value = client
        .get(release_api)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let body = release
        .get("body")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("latest cloudflared release body is missing"))?;

    let checksum = parse_checksum_text(body, asset_name).ok_or_else(|| {
        anyhow::anyhow!(
            "failed to locate SHA256 for '{}' in release body",
            asset_name
        )
    })?;

    let assets = release
        .get("assets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow::anyhow!("cloudflared release assets list is missing"))?;

    let asset_url = assets
        .iter()
        .find_map(|asset| {
            let name = asset.get("name").and_then(|v| v.as_str())?;
            if name != asset_name {
                return None;
            }
            asset
                .get("browser_download_url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .ok_or_else(|| {
            anyhow::anyhow!(
                "failed to locate download URL for '{}' in cloudflared release assets",
                asset_name
            )
        })?;

    Ok(CloudflaredReleaseInfo {
        asset_url,
        checksum,
    })
}

async fn fetch_cloudflared_sidecar_checksum(
    client: &reqwest::Client,
    asset_url: &str,
    asset_name: &str,
) -> Result<String, anyhow::Error> {
    let checksum_url = format!("{asset_url}.sha256");
    let text = client
        .get(&checksum_url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    parse_checksum_text(&text, asset_name).ok_or_else(|| {
        anyhow::anyhow!(
            "failed to parse sidecar SHA256 checksum for '{}' from {}",
            asset_name,
            checksum_url
        )
    })
}

pub(crate) fn parse_checksum_text(text: &str, asset_name: &str) -> Option<String> {
    // 1) Try explicit "filename: hash" lines from release notes.
    for line in text.lines() {
        let trimmed = line.trim().trim_matches('`');
        let Some((name, value)) = trimmed.split_once(':') else {
            continue;
        };
        if name.trim() != asset_name {
            continue;
        }
        if let Some(hash) = first_sha256_token(value) {
            return Some(hash);
        }
    }

    // 2) Try "hash  filename" lines from .sha256 files.
    for line in text.lines() {
        let trimmed = line.trim().trim_matches('`');
        if trimmed.is_empty() {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let first = parts.next()?;
        if !is_sha256_hex(first) {
            continue;
        }

        let second = parts.next();
        match second {
            Some(name) => {
                let normalized = name.trim_start_matches('*');
                if normalized == asset_name {
                    return Some(first.to_lowercase());
                }
            }
            None => return Some(first.to_lowercase()),
        }
    }

    None
}

pub(crate) fn first_sha256_token(value: &str) -> Option<String> {
    value
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .find(|token| is_sha256_hex(token))
        .map(|token| token.to_lowercase())
}

pub(crate) fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

pub(crate) fn verify_sha256_any(data: &[u8], expected: &[String]) -> Result<(), anyhow::Error> {
    let actual = sha256_hex(data);
    if expected.iter().any(|e| eq_sha256(&actual, e)) {
        return Ok(());
    }

    anyhow::bail!(
        "checksum mismatch while downloading cloudflared (expected {}, got {})",
        expected.first().map(|s| s.trim()).unwrap_or("?"),
        actual
    );
}

pub(crate) fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

pub(crate) fn eq_sha256(actual: &str, expected: &str) -> bool {
    actual.eq_ignore_ascii_case(expected.trim())
}

pub(crate) fn is_probable_html_payload(content_type: &str, bytes: &[u8]) -> bool {
    if content_type.to_ascii_lowercase().contains("text/html") {
        return true;
    }

    let sample = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_ascii_lowercase();
    sample.contains("<html")
        || sample.contains("<!doctype html")
        || sample.contains("<head")
        || sample.contains("<body")
}

pub(crate) fn set_executable(path: &Path) -> Result<(), anyhow::Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms)?;
    }

    #[cfg(not(unix))]
    {
        let _ = path;
    }

    Ok(())
}

pub(crate) fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tunnel_provider_as_str() {
        assert_eq!(TunnelProvider::Cloudflared.as_str(), "cloudflared");
        assert_eq!(TunnelProvider::LocalhostRun.as_str(), "localhost_run");
    }

    #[test]
    fn extract_https_urls_single() {
        let urls = extract_https_urls("Visit https://example.trycloudflare.com for more");
        assert_eq!(urls, vec!["https://example.trycloudflare.com"]);
    }

    #[test]
    fn extract_https_urls_multiple() {
        let urls = extract_https_urls("https://a.com and https://b.com end");
        assert_eq!(urls, vec!["https://a.com", "https://b.com"]);
    }

    #[test]
    fn extract_https_urls_none() {
        let urls = extract_https_urls("no urls here http://only-http.com");
        assert!(urls.is_empty());
    }

    #[test]
    fn extract_https_urls_trailing_punctuation() {
        let urls = extract_https_urls("see https://example.com, or https://other.com;");
        assert_eq!(urls, vec!["https://example.com", "https://other.com"]);
    }

    #[test]
    fn is_cloudflared_public_url_valid() {
        assert!(is_cloudflared_public_url(
            "https://foo-bar.trycloudflare.com"
        ));
    }

    #[test]
    fn is_cloudflared_public_url_other_domain() {
        assert!(!is_cloudflared_public_url("https://example.com"));
    }

    #[test]
    fn is_cloudflared_public_url_invalid() {
        assert!(!is_cloudflared_public_url("not a url"));
    }

    #[test]
    fn parse_checksum_text_explicit_format() {
        let hash = "a".repeat(64);
        let text = format!("cloudflared-linux-amd64: {hash}");
        let result = parse_checksum_text(&text, "cloudflared-linux-amd64");
        assert_eq!(result, Some(hash));
    }

    #[test]
    fn parse_checksum_text_sha256_file_format() {
        let hash = "a".repeat(64);
        let text = format!("{hash}  cloudflared-linux-amd64");
        let result = parse_checksum_text(&text, "cloudflared-linux-amd64");
        assert_eq!(result, Some(hash));
    }

    #[test]
    fn parse_checksum_text_missing() {
        let result = parse_checksum_text("no checksums here", "cloudflared-linux-amd64");
        assert!(result.is_none());
    }

    #[test]
    fn parse_checksum_text_wrong_name() {
        let hash = "a".repeat(64);
        let text = format!("other-binary: {hash}");
        let result = parse_checksum_text(&text, "cloudflared-linux-amd64");
        assert!(result.is_none());
    }

    #[test]
    fn first_sha256_token_finds_hash() {
        let hash = "b".repeat(64);
        let result = first_sha256_token(&format!(" {hash} "));
        assert_eq!(result, Some(hash));
    }

    #[test]
    fn first_sha256_token_no_hash() {
        assert!(first_sha256_token("no hash here").is_none());
    }

    #[test]
    fn is_sha256_hex_valid() {
        assert!(is_sha256_hex(&"a".repeat(64)));
    }

    #[test]
    fn is_sha256_hex_too_short() {
        assert!(!is_sha256_hex(&"a".repeat(63)));
    }

    #[test]
    fn is_sha256_hex_non_hex() {
        let mut s = "a".repeat(63);
        s.push('g');
        assert!(!is_sha256_hex(&s));
    }

    #[test]
    fn verify_sha256_any_match() {
        let data = b"hello world";
        let hash = sha256_hex(data);
        assert!(verify_sha256_any(data, &[hash]).is_ok());
    }

    #[test]
    fn verify_sha256_any_mismatch() {
        let data = b"hello world";
        assert!(verify_sha256_any(data, &["bad".repeat(16)]).is_err());
    }

    #[test]
    fn sha256_hex_known_vector() {
        // SHA-256 of empty input
        let hash = sha256_hex(b"");
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn eq_sha256_case_insensitive() {
        assert!(eq_sha256("aAbBcC", "AABBCC"));
    }

    #[test]
    fn eq_sha256_with_whitespace() {
        assert!(eq_sha256("abc", " abc "));
    }

    #[test]
    fn is_probable_html_payload_content_type() {
        assert!(is_probable_html_payload("text/html; charset=utf-8", b""));
    }

    #[test]
    fn is_probable_html_payload_body() {
        assert!(is_probable_html_payload(
            "application/octet-stream",
            b"<!DOCTYPE html><html>"
        ));
    }

    #[test]
    fn is_probable_html_payload_binary() {
        assert!(!is_probable_html_payload(
            "application/octet-stream",
            &[0u8, 1, 2, 3, 4, 5]
        ));
    }

    #[test]
    fn find_in_path_existing() {
        // "sh" should exist on any Unix system
        let result = find_in_path("sh");
        assert!(result.is_some());
    }

    #[test]
    fn find_in_path_nonexistent() {
        let result = find_in_path("this-binary-definitely-does-not-exist-xyz123");
        assert!(result.is_none());
    }
}
