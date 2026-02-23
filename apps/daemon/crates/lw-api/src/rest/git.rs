mod git_helpers;

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::process::{Command, Output};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::state::AppState;
#[cfg(test)]
use git_helpers::porcelain_code_to_status;
use git_helpers::{append_patch_segment, collect_ignored_dirs, parse_numstat, parse_porcelain};

#[derive(Deserialize)]
pub struct GitDiffQuery {
    pub workspace_id: Uuid,
    pub force: Option<bool>,
}

#[derive(Serialize)]
pub struct GitDiffResponse {
    pub patch: String,
}

#[derive(Clone)]
struct CachedDiff {
    patch: String,
    expires_at: Instant,
}

const GIT_DIFF_CACHE_TTL: Duration = Duration::from_millis(1200);

fn git_diff_cache() -> &'static Mutex<HashMap<Uuid, CachedDiff>> {
    static CACHE: OnceLock<Mutex<HashMap<Uuid, CachedDiff>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<Output, ApiErrorResponse> {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(format!("Failed to run git: {e}")),
        })
}

fn command_stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}

fn run_git_ok(cwd: &Path, args: &[&str]) -> Result<Output, ApiErrorResponse> {
    let output = run_git(cwd, args)?;
    if output.status.success() {
        Ok(output)
    } else {
        let stderr = command_stderr(&output);
        Err(ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal(format!("git {} failed: {stderr}", args.join(" "))),
        })
    }
}

fn run_git_diff(cwd: &Path, args: &[&str]) -> Result<String, ApiErrorResponse> {
    let output = run_git(cwd, args)?;
    let code = output.status.code().unwrap_or_default();
    if output.status.success() || code == 1 {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let stderr = command_stderr(&output);
    Err(ApiErrorResponse {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: ApiError::internal(format!("git {} failed: {stderr}", args.join(" "))),
    })
}

fn ensure_git_repo(cwd: &Path) -> Result<(), ApiErrorResponse> {
    let output = run_git(cwd, &["rev-parse", "--is-inside-work-tree"])?;
    if !output.status.success() {
        return Err(ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new("NOT_GIT_REPO", "Workspace is not a Git repository"),
        });
    }
    let inside = String::from_utf8_lossy(&output.stdout).trim() == "true";
    if inside {
        Ok(())
    } else {
        Err(ApiErrorResponse {
            status: StatusCode::BAD_REQUEST,
            error: ApiError::new("NOT_GIT_REPO", "Workspace is not a Git repository"),
        })
    }
}

fn collect_untracked_patches(cwd: &Path) -> Result<String, ApiErrorResponse> {
    let output = run_git_ok(cwd, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    let mut untracked_paths: Vec<String> = Vec::new();
    for bytes in output.stdout.split(|byte| *byte == 0) {
        if bytes.is_empty() {
            continue;
        }
        untracked_paths.push(String::from_utf8_lossy(bytes).to_string());
    }

    if untracked_paths.is_empty() {
        return Ok(String::new());
    }

    let max_workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    let worker_count = max_workers.min(untracked_paths.len());

    if worker_count <= 1 {
        let mut patch = String::new();
        for path in untracked_paths {
            let file_patch = run_git_diff(
                cwd,
                &[
                    "diff",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-renames",
                    "--unified=3",
                    "--no-index",
                    "--",
                    "/dev/null",
                    &path,
                ],
            )?;
            append_patch_segment(&mut patch, &file_patch);
        }
        return Ok(patch);
    }

    let chunk_size = untracked_paths.len().div_ceil(worker_count);
    let mut workers = Vec::with_capacity(worker_count);

    for paths_chunk in untracked_paths.chunks(chunk_size) {
        let repo_root = cwd.to_path_buf();
        let chunk_paths = paths_chunk.to_vec();
        workers.push(std::thread::spawn(
            move || -> Result<String, ApiErrorResponse> {
                let mut chunk_patch = String::new();
                for path in chunk_paths {
                    let file_patch = run_git_diff(
                        &repo_root,
                        &[
                            "diff",
                            "--no-color",
                            "--no-ext-diff",
                            "--no-renames",
                            "--unified=3",
                            "--no-index",
                            "--",
                            "/dev/null",
                            &path,
                        ],
                    )?;
                    append_patch_segment(&mut chunk_patch, &file_patch);
                }
                Ok(chunk_patch)
            },
        ));
    }

    let mut patch = String::new();
    for worker in workers {
        let chunk_patch = worker.join().map_err(|_| ApiErrorResponse {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: ApiError::internal("Failed to join untracked diff worker"),
        })??;
        if !chunk_patch.is_empty() {
            append_patch_segment(&mut patch, &chunk_patch);
        }
    }

    Ok(patch)
}

pub async fn diff(
    State(state): State<AppState>,
    Query(query): Query<GitDiffQuery>,
) -> Result<Json<GitDiffResponse>, ApiErrorResponse> {
    if !query.force.unwrap_or(false) {
        if let Ok(cache) = git_diff_cache().lock() {
            if let Some(cached) = cache.get(&query.workspace_id) {
                if cached.expires_at > Instant::now() {
                    return Ok(Json(GitDiffResponse {
                        patch: cached.patch.clone(),
                    }));
                }
            }
        }
    }

    let workspace_root = state
        .workspace_registry
        .resolve(&query.workspace_id, ".")
        .await
        .map_err(|e| {
            let (status, error) = ApiError::fs_error(&e);
            ApiErrorResponse { status, error }
        })?;

    ensure_git_repo(&workspace_root)?;

    let has_head = run_git(&workspace_root, &["rev-parse", "--verify", "HEAD"])?
        .status
        .success();

    let mut patch = if has_head {
        run_git_diff(
            &workspace_root,
            &[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-renames",
                "--unified=3",
                "HEAD",
                "--",
                ".",
            ],
        )?
    } else {
        let staged = run_git_diff(
            &workspace_root,
            &[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-renames",
                "--unified=3",
                "--cached",
            ],
        )?;
        let unstaged = run_git_diff(
            &workspace_root,
            &[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-renames",
                "--unified=3",
            ],
        )?;
        format!("{staged}{unstaged}")
    };

    let untracked = collect_untracked_patches(&workspace_root)?;
    if !untracked.is_empty() {
        if !patch.is_empty() && !patch.ends_with('\n') {
            patch.push('\n');
        }
        patch.push_str(&untracked);
    }

    if let Ok(mut cache) = git_diff_cache().lock() {
        cache.insert(
            query.workspace_id,
            CachedDiff {
                patch: patch.clone(),
                expires_at: Instant::now() + GIT_DIFF_CACHE_TTL,
            },
        );
    }

    Ok(Json(GitDiffResponse { patch }))
}

// ── Git Status endpoint ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct GitStatusQuery {
    pub workspace_id: Uuid,
    pub force: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct GitFileStatus {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct GitStatusResponse {
    pub files: BTreeMap<String, GitFileStatus>,
    pub ignored_dirs: Vec<String>,
}

#[derive(Clone)]
struct CachedStatus {
    response: GitStatusResponse,
    expires_at: Instant,
}

const GIT_STATUS_CACHE_TTL: Duration = Duration::from_millis(1200);

fn git_status_cache() -> &'static Mutex<BTreeMap<Uuid, CachedStatus>> {
    static CACHE: OnceLock<Mutex<BTreeMap<Uuid, CachedStatus>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

/// Compute git status for a workspace root directory.
/// This is the core logic shared by the REST handler and WS push.
pub fn compute_git_status(workspace_root: &Path) -> Result<GitStatusResponse, ApiErrorResponse> {
    ensure_git_repo(workspace_root)?;

    // Determine workspace path relative to git toplevel so we can
    // filter and strip paths (git reports paths from the repo root).
    let prefix = {
        let toplevel_out = run_git_ok(workspace_root, &["rev-parse", "--show-toplevel"])?;
        let toplevel = String::from_utf8_lossy(&toplevel_out.stdout)
            .trim()
            .to_string();
        let toplevel_path = Path::new(&toplevel);
        let rel = workspace_root
            .strip_prefix(toplevel_path)
            .unwrap_or(Path::new(""));
        let s = rel.to_string_lossy().to_string();
        if s.is_empty() {
            s
        } else {
            format!("{s}/")
        }
    };

    // 1. File statuses via porcelain
    let porcelain_output = run_git_ok(workspace_root, &["status", "--porcelain=v1", "-z"])?;
    let mut files = parse_porcelain(&porcelain_output.stdout);

    // Filter and strip prefix — keep only files under this workspace
    if !prefix.is_empty() {
        files = files
            .into_iter()
            .filter_map(|(path, status)| {
                path.strip_prefix(&prefix)
                    .map(|stripped| (stripped.to_string(), status))
            })
            .collect();
    }

    // 2. Per-file line counts
    let has_head = run_git(workspace_root, &["rev-parse", "--verify", "HEAD"])?
        .status
        .success();
    if has_head {
        let numstat_output = run_git(workspace_root, &["diff", "--numstat", "HEAD"])?;
        if numstat_output.status.success() {
            let numstat_str = String::from_utf8_lossy(&numstat_output.stdout).to_string();
            parse_numstat(&numstat_str, &mut files, &prefix);
        }
    } else {
        // No HEAD — try cached + unstaged
        let cached = run_git(workspace_root, &["diff", "--numstat", "--cached"]);
        if let Ok(out) = cached {
            if out.status.success() {
                parse_numstat(&String::from_utf8_lossy(&out.stdout), &mut files, &prefix);
            }
        }
        let unstaged = run_git(workspace_root, &["diff", "--numstat"]);
        if let Ok(out) = unstaged {
            if out.status.success() {
                parse_numstat(&String::from_utf8_lossy(&out.stdout), &mut files, &prefix);
            }
        }
    }

    // 3. Ignored paths — collapse to top-level dirs (relative to workspace)
    let ignored_output = run_git(
        workspace_root,
        &[
            "ls-files",
            "-z",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ],
    )?;
    let ignored_dirs = if ignored_output.status.success() {
        collect_ignored_dirs(&ignored_output.stdout, &prefix)
    } else {
        Vec::new()
    };

    Ok(GitStatusResponse {
        files,
        ignored_dirs,
    })
}

pub async fn status(
    State(state): State<AppState>,
    Query(query): Query<GitStatusQuery>,
) -> Result<Json<GitStatusResponse>, ApiErrorResponse> {
    if !query.force.unwrap_or(false) {
        if let Ok(cache) = git_status_cache().lock() {
            if let Some(cached) = cache.get(&query.workspace_id) {
                if cached.expires_at > Instant::now() {
                    return Ok(Json(cached.response.clone()));
                }
            }
        }
    }

    let workspace_root = state
        .workspace_registry
        .resolve(&query.workspace_id, ".")
        .await
        .map_err(|e| {
            let (status, error) = ApiError::fs_error(&e);
            ApiErrorResponse { status, error }
        })?;

    let response = compute_git_status(&workspace_root)?;

    if let Ok(mut cache) = git_status_cache().lock() {
        cache.insert(
            query.workspace_id,
            CachedStatus {
                response: response.clone(),
                expires_at: Instant::now() + GIT_STATUS_CACHE_TTL,
            },
        );
    }

    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── porcelain_code_to_status ──────────────────────────────────────

    #[test]
    fn porcelain_untracked() {
        assert_eq!(porcelain_code_to_status(b'?', b'?'), "untracked");
    }

    #[test]
    fn porcelain_added_x() {
        assert_eq!(porcelain_code_to_status(b'A', b' '), "added");
    }

    #[test]
    fn porcelain_added_y() {
        assert_eq!(porcelain_code_to_status(b' ', b'A'), "added");
    }

    #[test]
    fn porcelain_deleted_x() {
        assert_eq!(porcelain_code_to_status(b'D', b' '), "deleted");
    }

    #[test]
    fn porcelain_deleted_y() {
        assert_eq!(porcelain_code_to_status(b' ', b'D'), "deleted");
    }

    #[test]
    fn porcelain_renamed_x() {
        assert_eq!(porcelain_code_to_status(b'R', b' '), "renamed");
    }

    #[test]
    fn porcelain_renamed_y() {
        assert_eq!(porcelain_code_to_status(b' ', b'R'), "renamed");
    }

    #[test]
    fn porcelain_modified_m() {
        assert_eq!(porcelain_code_to_status(b'M', b' '), "modified");
    }

    #[test]
    fn porcelain_modified_u() {
        assert_eq!(porcelain_code_to_status(b'U', b' '), "modified");
    }

    #[test]
    fn porcelain_fallback() {
        assert_eq!(porcelain_code_to_status(b' ', b' '), "modified");
    }

    // ── parse_porcelain ───────────────────────────────────────────────

    #[test]
    fn parse_porcelain_empty() {
        let files = parse_porcelain(b"");
        assert!(files.is_empty());
    }

    #[test]
    fn parse_porcelain_single_modified() {
        // "M  src/main.rs\0"
        let raw = b"M  src/main.rs\0";
        let files = parse_porcelain(raw);
        assert_eq!(files.len(), 1);
        assert_eq!(files["src/main.rs"].status, "modified");
        assert!(files["src/main.rs"].additions.is_none());
    }

    #[test]
    fn parse_porcelain_multiple_files() {
        let raw = b"M  file_a.rs\0A  file_b.rs\0";
        let files = parse_porcelain(raw);
        assert_eq!(files.len(), 2);
        assert_eq!(files["file_a.rs"].status, "modified");
        assert_eq!(files["file_b.rs"].status, "added");
    }

    #[test]
    fn parse_porcelain_deleted() {
        let raw = b"D  gone.rs\0";
        let files = parse_porcelain(raw);
        assert_eq!(files["gone.rs"].status, "deleted");
    }

    #[test]
    fn parse_porcelain_rename_consumes_extra_field() {
        // Renames produce: "R  new_name\0old_name\0"
        let raw = b"R  new_name.rs\0old_name.rs\0M  other.rs\0";
        let files = parse_porcelain(raw);
        assert_eq!(files.len(), 2);
        assert_eq!(files["new_name.rs"].status, "renamed");
        assert_eq!(files["other.rs"].status, "modified");
        assert!(!files.contains_key("old_name.rs"));
    }

    #[test]
    fn parse_porcelain_additions_are_none() {
        let raw = b"?? newfile.txt\0";
        let files = parse_porcelain(raw);
        assert!(files["newfile.txt"].additions.is_none());
        assert!(files["newfile.txt"].deletions.is_none());
    }

    #[test]
    fn parse_porcelain_skips_short_entries() {
        // Entries shorter than 4 bytes should be skipped
        let raw = b"ab\0M  valid.rs\0";
        let files = parse_porcelain(raw);
        assert_eq!(files.len(), 1);
        assert!(files.contains_key("valid.rs"));
    }

    #[test]
    fn parse_porcelain_btreemap_sorted() {
        let raw = b"M  z.rs\0M  a.rs\0M  m.rs\0";
        let files = parse_porcelain(raw);
        let keys: Vec<_> = files.keys().collect();
        assert_eq!(keys, vec!["a.rs", "m.rs", "z.rs"]);
    }

    // ── parse_numstat ─────────────────────────────────────────────────

    #[test]
    fn parse_numstat_updates_existing() {
        let mut files = BTreeMap::new();
        files.insert(
            "file.rs".to_string(),
            GitFileStatus {
                status: "modified".to_string(),
                additions: None,
                deletions: None,
            },
        );
        parse_numstat("10\t5\tfile.rs\n", &mut files, "");
        assert_eq!(files["file.rs"].additions, Some(10));
        assert_eq!(files["file.rs"].deletions, Some(5));
    }

    #[test]
    fn parse_numstat_ignores_missing_entries() {
        let mut files = BTreeMap::new();
        files.insert(
            "existing.rs".to_string(),
            GitFileStatus {
                status: "modified".to_string(),
                additions: None,
                deletions: None,
            },
        );
        parse_numstat("3\t1\tunknown.rs\n", &mut files, "");
        assert!(files["existing.rs"].additions.is_none());
    }

    #[test]
    fn parse_numstat_strips_prefix() {
        let mut files = BTreeMap::new();
        files.insert(
            "file.rs".to_string(),
            GitFileStatus {
                status: "modified".to_string(),
                additions: None,
                deletions: None,
            },
        );
        parse_numstat("7\t2\tsrc/file.rs\n", &mut files, "src/");
        assert_eq!(files["file.rs"].additions, Some(7));
    }

    #[test]
    fn parse_numstat_binary_file() {
        let mut files = BTreeMap::new();
        files.insert(
            "image.png".to_string(),
            GitFileStatus {
                status: "added".to_string(),
                additions: None,
                deletions: None,
            },
        );
        parse_numstat("-\t-\timage.png\n", &mut files, "");
        assert!(files["image.png"].additions.is_none());
        assert!(files["image.png"].deletions.is_none());
    }

    #[test]
    fn parse_numstat_multiple_lines() {
        let mut files = BTreeMap::new();
        files.insert(
            "a.rs".to_string(),
            GitFileStatus {
                status: "modified".to_string(),
                additions: None,
                deletions: None,
            },
        );
        files.insert(
            "b.rs".to_string(),
            GitFileStatus {
                status: "modified".to_string(),
                additions: None,
                deletions: None,
            },
        );
        parse_numstat("1\t2\ta.rs\n3\t4\tb.rs\n", &mut files, "");
        assert_eq!(files["a.rs"].additions, Some(1));
        assert_eq!(files["b.rs"].additions, Some(3));
    }

    #[test]
    fn parse_numstat_skips_malformed() {
        let mut files = BTreeMap::new();
        files.insert(
            "ok.rs".to_string(),
            GitFileStatus {
                status: "modified".to_string(),
                additions: None,
                deletions: None,
            },
        );
        parse_numstat("bad_line\n1\t2\tok.rs\n", &mut files, "");
        assert_eq!(files["ok.rs"].additions, Some(1));
    }

    // ── collect_ignored_dirs ──────────────────────────────────────────

    #[test]
    fn collect_ignored_dirs_empty() {
        let dirs = collect_ignored_dirs(b"", "");
        assert!(dirs.is_empty());
    }

    #[test]
    fn collect_ignored_dirs_strips_trailing_slash() {
        let dirs = collect_ignored_dirs(b"node_modules/\0", "");
        assert_eq!(dirs, vec!["node_modules"]);
    }

    #[test]
    fn collect_ignored_dirs_strips_prefix() {
        let dirs = collect_ignored_dirs(b"src/target/\0", "src/");
        assert_eq!(dirs, vec!["target"]);
    }

    #[test]
    fn collect_ignored_dirs_skips_outside_prefix() {
        let dirs = collect_ignored_dirs(b"other/dir/\0src/target/\0", "src/");
        assert_eq!(dirs, vec!["target"]);
    }

    #[test]
    fn collect_ignored_dirs_deduplicates() {
        let dirs = collect_ignored_dirs(b"dist/\0dist/\0", "");
        assert_eq!(dirs, vec!["dist"]);
    }

    #[test]
    fn collect_ignored_dirs_returns_sorted_entries() {
        let dirs = collect_ignored_dirs(b"z/\0a/\0m/\0", "");
        assert_eq!(dirs, vec!["a", "m", "z"]);
    }

    #[test]
    fn parse_numstat_prefix_skips_non_matching_paths() {
        let mut files = BTreeMap::new();
        files.insert(
            "inside.rs".to_string(),
            GitFileStatus {
                status: "modified".to_string(),
                additions: None,
                deletions: None,
            },
        );
        parse_numstat("4\t2\toutside/inside.rs\n", &mut files, "src/");
        assert!(files["inside.rs"].additions.is_none());
    }

    // ── append_patch_segment ──────────────────────────────────────────

    #[test]
    fn append_patch_segment_empty_is_noop() {
        let mut target = String::from("existing");
        append_patch_segment(&mut target, "");
        assert_eq!(target, "existing");
    }

    #[test]
    fn append_patch_segment_adds_trailing_newline() {
        let mut target = String::new();
        append_patch_segment(&mut target, "diff --git a/f");
        assert!(target.ends_with('\n'));
    }

    #[test]
    fn append_patch_segment_separates_with_newline() {
        let mut target = String::from("first\n");
        append_patch_segment(&mut target, "second");
        assert_eq!(target, "first\nsecond\n");
    }
}
