use std::path::{Path, PathBuf};

/// Holds a configurable base directory for all daemon file paths.
///
/// Use `ConfigPaths::new()` for production (resolves `~/.loopwire`),
/// or `ConfigPaths::with_base()` for testing with an isolated directory.
#[derive(Debug, Clone)]
pub struct ConfigPaths {
    base: PathBuf,
}

impl ConfigPaths {
    /// Create paths rooted at `~/.loopwire`. Returns an error if the home
    /// directory cannot be determined.
    pub fn new() -> anyhow::Result<Self> {
        let home = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("Could not determine home directory"))?;
        Ok(Self {
            base: home.join(".loopwire"),
        })
    }

    /// Create paths rooted at a custom base directory (useful for tests).
    pub fn with_base(base: PathBuf) -> Self {
        Self { base }
    }

    pub fn config_dir(&self) -> &Path {
        &self.base
    }

    pub fn config_path(&self) -> PathBuf {
        self.base.join("config.toml")
    }

    pub fn pid_path(&self) -> PathBuf {
        self.base.join("loopwired.pid")
    }

    pub fn token_path(&self) -> PathBuf {
        self.base.join("bootstrap_token")
    }

    pub fn sessions_path(&self) -> PathBuf {
        self.base.join("session_hashes")
    }

    pub fn host_id_path(&self) -> PathBuf {
        self.base.join("host_id")
    }

    pub fn trust_key_path(&self) -> PathBuf {
        self.base.join("remote_trust_key")
    }

    pub fn bin_dir(&self) -> PathBuf {
        self.base.join("bin")
    }

    /// Ensure the config directory exists, creating it if necessary.
    pub fn ensure_config_dir(&self) -> anyhow::Result<PathBuf> {
        if !self.base.exists() {
            std::fs::create_dir_all(&self.base)?;
        }
        Ok(self.base.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_dir_returns_base_path() {
        let paths = ConfigPaths::with_base(PathBuf::from("/tmp/test-lw"));
        assert_eq!(paths.config_dir(), Path::new("/tmp/test-lw"));
    }

    #[test]
    fn path_accessors_return_expected_filenames() {
        let base = PathBuf::from("/base");
        let paths = ConfigPaths::with_base(base.clone());

        assert_eq!(paths.config_path(), base.join("config.toml"));
        assert_eq!(paths.pid_path(), base.join("loopwired.pid"));
        assert_eq!(paths.token_path(), base.join("bootstrap_token"));
        assert_eq!(paths.sessions_path(), base.join("session_hashes"));
        assert_eq!(paths.host_id_path(), base.join("host_id"));
        assert_eq!(paths.trust_key_path(), base.join("remote_trust_key"));
        assert_eq!(paths.bin_dir(), base.join("bin"));
    }

    #[test]
    fn ensure_config_dir_creates_directory() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("nested").join("config");
        let paths = ConfigPaths::with_base(base.clone());

        assert!(!base.exists());
        let result = paths.ensure_config_dir().unwrap();
        assert_eq!(result, base);
        assert!(base.exists());
    }

    #[test]
    fn ensure_config_dir_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("config");
        let paths = ConfigPaths::with_base(base);

        paths.ensure_config_dir().unwrap();
        paths.ensure_config_dir().unwrap(); // second call should not error
    }

    #[test]
    fn new_returns_ok_with_home_set() {
        // In normal environments, $HOME is set
        let result = ConfigPaths::new();
        assert!(result.is_ok());
        let paths = result.unwrap();
        assert!(paths.config_dir().ends_with(".loopwire"));
    }
}
