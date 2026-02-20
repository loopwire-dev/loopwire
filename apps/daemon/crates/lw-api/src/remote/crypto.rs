use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::RemoteError;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct TrustedDevicePayload {
    pub host_id: String,
    pub exp: i64,
}

pub(crate) fn hash_pin(pin: &str) -> Result<String, RemoteError> {
    use rand::Rng;

    let mut rng = rand::thread_rng();
    let salt: [u8; 16] = rng.gen();

    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(pin.as_bytes());
    let digest = hasher.finalize();

    Ok(format!("{}:{}", hex::encode(salt), hex::encode(digest)))
}

pub(crate) fn verify_pin(pin_hash: &str, pin: &str) -> Result<bool, RemoteError> {
    let (salt_hex, digest_hex) = pin_hash
        .split_once(':')
        .ok_or_else(|| RemoteError::Internal(anyhow::anyhow!("invalid PIN hash format")))?;
    let salt =
        hex::decode(salt_hex).map_err(|e| RemoteError::Internal(anyhow::anyhow!(e.to_string())))?;
    let expected = hex::decode(digest_hex)
        .map_err(|e| RemoteError::Internal(anyhow::anyhow!(e.to_string())))?;

    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(pin.as_bytes());
    let actual = hasher.finalize();

    Ok(constant_time_eq(&expected, &actual))
}

pub(crate) fn constant_time_eq(expected: &[u8], actual: &[u8]) -> bool {
    if expected.len() != actual.len() {
        return false;
    }
    let mut diff = 0u8;
    for (lhs, rhs) in expected.iter().zip(actual.iter()) {
        diff |= lhs ^ rhs;
    }
    diff == 0
}

pub(crate) fn sign_payload(key: &[u8], payload_b64: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(key);
    hasher.update(b":");
    hasher.update(payload_b64.as_bytes());
    hasher.finalize().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_pin_and_verify_roundtrip() {
        let hash = hash_pin("1234").unwrap();
        assert!(verify_pin(&hash, "1234").unwrap());
    }

    #[test]
    fn verify_pin_wrong_pin() {
        let hash = hash_pin("1234").unwrap();
        assert!(!verify_pin(&hash, "5678").unwrap());
    }

    #[test]
    fn verify_pin_malformed_hash() {
        assert!(verify_pin("nocolon", "1234").is_err());
    }

    #[test]
    fn constant_time_eq_equal() {
        assert!(constant_time_eq(b"hello", b"hello"));
    }

    #[test]
    fn constant_time_eq_unequal() {
        assert!(!constant_time_eq(b"hello", b"world"));
    }

    #[test]
    fn constant_time_eq_different_lengths() {
        assert!(!constant_time_eq(b"short", b"longer"));
    }

    #[test]
    fn sign_payload_deterministic() {
        let key = b"test-key";
        let payload = "some-payload";
        let sig1 = sign_payload(key, payload);
        let sig2 = sign_payload(key, payload);
        assert_eq!(sig1, sig2);
    }

    #[test]
    fn sign_payload_different_keys_differ() {
        let sig1 = sign_payload(b"key-a", "payload");
        let sig2 = sign_payload(b"key-b", "payload");
        assert_ne!(sig1, sig2);
    }
}
