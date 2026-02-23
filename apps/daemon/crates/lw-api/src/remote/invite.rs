use chrono::Utc;

use super::{ActiveShare, RemoteError};

pub(super) fn validate_invite(share: &ActiveShare, invite_hash: &str) -> Result<(), RemoteError> {
    if share.invite_hash != invite_hash {
        return Err(RemoteError::InvalidInvite);
    }
    if share.invite_used {
        return Err(RemoteError::InviteUsed);
    }
    if Utc::now() > share.invite_expires_at {
        return Err(RemoteError::InviteExpired);
    }
    Ok(())
}

pub(super) fn build_connect_url(base: &str, backend_url: &str, invite_token: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    let separator = if trimmed.contains('?') { '&' } else { '?' };
    let target = obfuscate_backend_target(backend_url, invite_token);
    format!("{trimmed}{separator}target={target}&invite={invite_token}",)
}

pub(super) fn obfuscate_backend_target(backend_url: &str, invite_token: &str) -> String {
    use rand::Rng;

    let invite_key = parse_hex_or_bytes(invite_token);
    if invite_key.is_empty() {
        return String::new();
    }

    let mut rng = rand::thread_rng();
    let nonce: [u8; 8] = rng.gen();
    let plain = backend_url.as_bytes();
    let mut cipher = Vec::with_capacity(plain.len());

    for (i, byte) in plain.iter().enumerate() {
        let key = stream_key_byte(i, &invite_key, &nonce);
        cipher.push(byte ^ key);
    }

    format!("{}.{}", hex::encode(nonce), hex::encode(cipher))
}

pub(super) fn parse_hex_or_bytes(input: &str) -> Vec<u8> {
    if input.len().is_multiple_of(2) && input.chars().all(|c| c.is_ascii_hexdigit()) {
        hex::decode(input).unwrap_or_else(|_| input.as_bytes().to_vec())
    } else {
        input.as_bytes().to_vec()
    }
}

pub(super) fn stream_key_byte(index: usize, invite_key: &[u8], nonce: &[u8]) -> u8 {
    let invite = invite_key[index % invite_key.len()];
    let salt = nonce[index % nonce.len()];
    invite ^ salt ^ (index as u8).wrapping_mul(31)
}
