use crate::security::FsError;
use base64::{engine::general_purpose, Engine as _};
use std::path::Path;

/// Default max file size: 10 MB
const DEFAULT_MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

#[derive(Debug, serde::Serialize)]
pub struct FileContent {
    pub content: String,
    pub size: u64,
    pub is_binary: bool,
    pub binary_content_base64: Option<String>,
}

/// Read a file's content with a default 10 MB size limit.
pub fn read_file(path: &Path) -> Result<FileContent, FsError> {
    read_file_with_options(path, DEFAULT_MAX_FILE_SIZE, false)
}

/// Read a file's content with binary data included as base64 when applicable.
pub fn read_file_with_binary(path: &Path) -> Result<FileContent, FsError> {
    read_file_with_options(path, DEFAULT_MAX_FILE_SIZE, true)
}

/// Read a file's content with a configurable size limit.
pub fn read_file_with_limit(path: &Path, max_size: u64) -> Result<FileContent, FsError> {
    read_file_with_options(path, max_size, false)
}

/// Read a file's content with a configurable size limit and optional binary payload.
pub fn read_file_with_options(
    path: &Path,
    max_size: u64,
    include_binary_content: bool,
) -> Result<FileContent, FsError> {
    let metadata = std::fs::metadata(path)?;
    let size = metadata.len();

    if size > max_size {
        return Err(FsError::FileTooLarge {
            size,
            max: max_size,
        });
    }

    // Read raw bytes to detect binary
    let bytes = std::fs::read(path)?;
    let is_binary = bytes.iter().take(8192).any(|&b| b == 0);

    let content = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };
    let binary_content_base64 = if is_binary && include_binary_content {
        Some(general_purpose::STANDARD.encode(&bytes))
    } else {
        None
    };

    Ok(FileContent {
        content,
        size,
        is_binary,
        binary_content_base64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn read_text_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("hello.txt");
        fs::write(&path, "hello world").unwrap();

        let result = read_file(&path).unwrap();
        assert_eq!(result.content, "hello world");
        assert_eq!(result.size, 11);
        assert!(!result.is_binary);
        assert_eq!(result.binary_content_base64, None);
    }

    #[test]
    fn read_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.txt");
        fs::write(&path, "").unwrap();

        let result = read_file(&path).unwrap();
        assert_eq!(result.content, "");
        assert_eq!(result.size, 0);
        assert!(!result.is_binary);
        assert_eq!(result.binary_content_base64, None);
    }

    #[test]
    fn read_binary_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("binary.bin");
        let mut data = vec![0u8; 100];
        data[50] = 0; // null byte
        fs::write(&path, &data).unwrap();

        let result = read_file(&path).unwrap();
        assert!(result.is_binary);
        assert_eq!(result.content, "");
        assert_eq!(result.size, 100);
        assert_eq!(result.binary_content_base64, None);
    }

    #[test]
    fn read_binary_file_with_binary_content() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("binary.bin");
        let data = vec![0u8, 1, 2, 3];
        fs::write(&path, &data).unwrap();

        let result = read_file_with_binary(&path).unwrap();
        assert!(result.is_binary);
        assert_eq!(result.binary_content_base64, Some("AAECAw==".to_string()));
    }

    #[test]
    fn read_nonexistent_file() {
        let result = read_file(Path::new("/nonexistent/file.txt"));
        assert!(matches!(result, Err(FsError::Io(_))));
    }

    #[test]
    fn read_file_too_large() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("big.txt");
        fs::write(&path, "x".repeat(200)).unwrap();

        let result = read_file_with_limit(&path, 100);
        assert!(matches!(
            result,
            Err(FsError::FileTooLarge {
                size: 200,
                max: 100
            })
        ));
    }

    #[test]
    fn read_file_at_exact_limit() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("exact.txt");
        fs::write(&path, "x".repeat(100)).unwrap();

        let result = read_file_with_limit(&path, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn read_utf8_lossy() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("mixed.txt");
        // Valid UTF-8 with some high bytes (but no null bytes)
        let data: Vec<u8> = vec![0x48, 0x65, 0x6C, 0x6C, 0x6F, 0xC3, 0xA9]; // "Helloé"
        fs::write(&path, &data).unwrap();

        let result = read_file(&path).unwrap();
        assert!(!result.is_binary);
        assert_eq!(result.content, "Helloé");
        assert_eq!(result.binary_content_base64, None);
    }

    #[test]
    fn file_content_serialization() {
        let content = FileContent {
            content: "test".to_string(),
            size: 4,
            is_binary: false,
            binary_content_base64: None,
        };
        let json = serde_json::to_value(&content).unwrap();
        assert_eq!(json["content"], "test");
        assert_eq!(json["size"], 4);
        assert_eq!(json["is_binary"], false);
        assert_eq!(json["binary_content_base64"], serde_json::Value::Null);
    }
}
