use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: Option<u64>,
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
}

pub fn suggest_roots() -> Vec<String> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        let candidates = [
            "Projects",
            "projects",
            "src",
            "code",
            "dev",
            "repos",
            "workspace",
        ];
        for dir in &candidates {
            let path = home.join(dir);
            if path.is_dir() {
                roots.push(path.to_string_lossy().to_string());
            }
        }
        roots.push(home.to_string_lossy().to_string());
    }
    roots
}

pub fn list_directory(path: &Path) -> Result<Vec<DirEntry>, std::io::Error> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        let kind = if metadata.is_dir() {
            EntryKind::Directory
        } else if metadata.file_type().is_symlink() {
            EntryKind::Symlink
        } else {
            EntryKind::File
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            kind,
            size: if metadata.is_file() {
                Some(metadata.len())
            } else {
                None
            },
            modified,
        });
    }
    entries.sort_by(|a, b| {
        let dir_order = |e: &DirEntry| if e.kind == EntryKind::Directory { 0 } else { 1 };
        dir_order(a).cmp(&dir_order(b)).then(a.name.cmp(&b.name))
    });
    Ok(entries)
}
