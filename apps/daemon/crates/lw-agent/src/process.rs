use std::process::Stdio;
use std::time::Duration;

pub fn terminate_process(pid: u32) -> bool {
    let term_status = std::process::Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .stderr(Stdio::null())
        .status();
    if !matches!(term_status, Ok(s) if s.success()) {
        return false;
    }

    for _ in 0..20 {
        if !is_process_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    let kill_status = std::process::Command::new("kill")
        .arg("-KILL")
        .arg(pid.to_string())
        .stderr(Stdio::null())
        .status();
    matches!(kill_status, Ok(s) if s.success()) && !is_process_alive(pid)
}

pub fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let status = std::process::Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stderr(Stdio::null())
            .status();
        matches!(status, Ok(s) if s.success())
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_process_alive_self() {
        let pid = std::process::id();
        assert!(is_process_alive(pid));
    }

    #[test]
    fn is_process_alive_nonexistent() {
        // Use a high-but-valid PID to avoid "illegal process id" stderr noise
        assert!(!is_process_alive(99_999));
    }
}
