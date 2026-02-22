use crate::security::FsError;
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

pub fn list_directory(path: &Path) -> Result<Vec<DirEntry>, FsError> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        // Use symlink_metadata to detect symlinks before following them
        let symlink_meta = entry.path().symlink_metadata()?;
        let is_symlink = symlink_meta.file_type().is_symlink();

        // For size/modified, use the followed metadata (entry.metadata follows symlinks)
        let metadata = entry.metadata()?;
        let kind = if is_symlink {
            EntryKind::Symlink
        } else if metadata.is_dir() {
            EntryKind::Directory
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn list_empty_directory() {
        let dir = TempDir::new().unwrap();
        let entries = list_directory(dir.path()).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn list_directory_with_files_and_dirs() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("b_file.txt"), "hello").unwrap();
        fs::write(dir.path().join("a_file.txt"), "world").unwrap();
        fs::create_dir(dir.path().join("z_dir")).unwrap();
        fs::create_dir(dir.path().join("a_dir")).unwrap();

        let entries = list_directory(dir.path()).unwrap();
        assert_eq!(entries.len(), 4);

        // Directories come first, sorted alphabetically
        assert_eq!(entries[0].name, "a_dir");
        assert_eq!(entries[0].kind, EntryKind::Directory);
        assert_eq!(entries[1].name, "z_dir");
        assert_eq!(entries[1].kind, EntryKind::Directory);

        // Then files, sorted alphabetically
        assert_eq!(entries[2].name, "a_file.txt");
        assert_eq!(entries[2].kind, EntryKind::File);
        assert_eq!(entries[3].name, "b_file.txt");
        assert_eq!(entries[3].kind, EntryKind::File);
    }

    #[test]
    fn list_directory_file_size() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("sized.txt"), "12345").unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();

        let entries = list_directory(dir.path()).unwrap();
        let subdir = entries.iter().find(|e| e.name == "subdir").unwrap();
        assert_eq!(subdir.size, None);

        let file = entries.iter().find(|e| e.name == "sized.txt").unwrap();
        assert_eq!(file.size, Some(5));
    }

    #[test]
    fn list_directory_modified_timestamp() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("file.txt"), "data").unwrap();

        let entries = list_directory(dir.path()).unwrap();
        let file = entries.iter().find(|e| e.name == "file.txt").unwrap();
        assert!(file.modified.is_some());
        assert!(file.modified.unwrap() > 0);
    }

    #[cfg(unix)]
    #[test]
    fn list_directory_detects_symlinks() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("target.txt"), "real").unwrap();
        std::os::unix::fs::symlink(dir.path().join("target.txt"), dir.path().join("link.txt"))
            .unwrap();

        let entries = list_directory(dir.path()).unwrap();
        let link = entries.iter().find(|e| e.name == "link.txt").unwrap();
        assert_eq!(link.kind, EntryKind::Symlink);

        let target = entries.iter().find(|e| e.name == "target.txt").unwrap();
        assert_eq!(target.kind, EntryKind::File);
    }

    #[test]
    fn list_nonexistent_directory() {
        let result = list_directory(Path::new("/nonexistent/path/xyz"));
        assert!(result.is_err());
    }

    #[test]
    fn suggest_roots_includes_home() {
        let roots = suggest_roots();
        // Should always include at least the home directory
        assert!(!roots.is_empty());
        let home = dirs::home_dir().unwrap().to_string_lossy().to_string();
        assert!(roots.contains(&home));
    }

    #[test]
    fn entry_kind_serialization() {
        assert_eq!(serde_json::to_string(&EntryKind::File).unwrap(), "\"file\"");
        assert_eq!(
            serde_json::to_string(&EntryKind::Directory).unwrap(),
            "\"directory\""
        );
        assert_eq!(
            serde_json::to_string(&EntryKind::Symlink).unwrap(),
            "\"symlink\""
        );
    }
}
