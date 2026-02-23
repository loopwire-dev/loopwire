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

    #[test]
    #[cfg(unix)]
    fn terminate_process_returns_false_for_nonexistent_pid() {
        assert!(!terminate_process(99_999));
    }

    #[test]
    #[cfg(unix)]
    fn terminate_process_kills_running_process() {
        // Redirect sleep's stdout/stderr to /dev/null so that the background
        // process does not hold the shell's output pipe open. Without this,
        // Command::output() would block until sleep exits (60 seconds).
        // With the redirect the shell prints the PID and exits promptly;
        // sleep is reparented to init/launchd which reaps it on exit.
        let output = std::process::Command::new("sh")
            .args(["-c", "sleep 60 >/dev/null 2>&1 & echo $!"])
            .output()
            .expect("failed to spawn background sleep");

        let pid_str = String::from_utf8_lossy(&output.stdout);
        let pid: u32 = pid_str
            .trim()
            .parse()
            .expect("shell did not output a valid PID");

        assert!(
            is_process_alive(pid),
            "process should be alive before termination"
        );

        let result = terminate_process(pid);

        assert!(
            result,
            "terminate_process should return true for a live process"
        );
        assert!(
            !is_process_alive(pid),
            "process should be dead after termination"
        );
    }
}
