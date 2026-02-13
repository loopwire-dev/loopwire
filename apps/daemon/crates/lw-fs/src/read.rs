use std::path::Path;

#[derive(Debug, serde::Serialize)]
pub struct FileContent {
    pub content: String,
    pub size: u64,
    pub is_binary: bool,
}

pub fn read_file(path: &Path) -> Result<FileContent, std::io::Error> {
    let metadata = std::fs::metadata(path)?;
    let size = metadata.len();

    // Read raw bytes to detect binary
    let bytes = std::fs::read(path)?;
    let is_binary = bytes.iter().take(8192).any(|&b| b == 0);

    let content = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    Ok(FileContent {
        content,
        size,
        is_binary,
    })
}
