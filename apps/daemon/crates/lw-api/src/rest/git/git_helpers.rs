use std::collections::{BTreeMap, HashSet};

use super::GitFileStatus;

pub(super) fn porcelain_code_to_status(x: u8, y: u8) -> &'static str {
    match (x, y) {
        (b'?', b'?') => "untracked",
        (b'A', _) | (_, b'A') => "added",
        (b'D', _) | (_, b'D') => "deleted",
        (b'R', _) | (_, b'R') => "renamed",
        (b'M', _) | (_, b'M') | (b'U', _) | (_, b'U') => "modified",
        _ => "modified",
    }
}

pub(super) fn parse_porcelain(raw: &[u8]) -> BTreeMap<String, GitFileStatus> {
    let mut files = BTreeMap::new();
    let mut iter = raw.split(|&b| b == 0);
    while let Some(entry) = iter.next() {
        if entry.len() < 4 {
            continue;
        }
        let x = entry[0];
        let y = entry[1];
        let path = String::from_utf8_lossy(&entry[3..]).to_string();
        let status = porcelain_code_to_status(x, y);
        files.insert(
            path,
            GitFileStatus {
                status: status.to_string(),
                additions: None,
                deletions: None,
            },
        );
        if x == b'R' || y == b'R' {
            let _ = iter.next();
        }
    }
    files
}

pub(super) fn parse_numstat(raw: &str, files: &mut BTreeMap<String, GitFileStatus>, prefix: &str) {
    for line in raw.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let additions = parts[0].parse::<u64>().ok();
        let deletions = parts[1].parse::<u64>().ok();
        let path = parts[2];
        let rel_path = if !prefix.is_empty() {
            match path.strip_prefix(prefix) {
                Some(stripped) => stripped,
                None => continue,
            }
        } else {
            path
        };
        if let Some(entry) = files.get_mut(rel_path) {
            entry.additions = additions;
            entry.deletions = deletions;
        }
    }
}

pub(super) fn collect_ignored_dirs(raw: &[u8], prefix: &str) -> Vec<String> {
    let mut dirs = HashSet::new();
    for bytes in raw.split(|&b| b == 0) {
        if bytes.is_empty() {
            continue;
        }
        let path = String::from_utf8_lossy(bytes).to_string();
        let rel_path = if !prefix.is_empty() {
            match path.strip_prefix(prefix) {
                Some(stripped) => stripped.to_string(),
                None => continue,
            }
        } else {
            path
        };
        let clean = rel_path.trim_end_matches('/').to_string();
        if !clean.is_empty() {
            dirs.insert(clean);
        }
    }
    let mut sorted: Vec<String> = dirs.into_iter().collect();
    sorted.sort();
    sorted
}

pub(super) fn append_patch_segment(target: &mut String, segment: &str) {
    if segment.is_empty() {
        return;
    }
    if !target.is_empty() && !target.ends_with('\n') {
        target.push('\n');
    }
    target.push_str(segment);
    if !target.ends_with('\n') {
        target.push('\n');
    }
}
