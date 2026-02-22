#![cfg(unix)]

use lw_pty::PtySession;
use std::path::PathBuf;
use uuid::Uuid;

fn tmp_dir() -> PathBuf {
    std::env::temp_dir()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawn_and_read_output() {
    let id = Uuid::new_v4();
    let session = PtySession::spawn(id, "echo", &["hello"], &tmp_dir(), vec![], 80, 24).unwrap();

    let mut rx = session.subscribe();
    let mut collected = Vec::new();

    // Collect output until the session stops or we get enough data
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(data) => collected.extend_from_slice(&data),
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Err(_) => continue,
                }
            }
            _ = tokio::time::sleep_until(deadline) => break,
        }
        if String::from_utf8_lossy(&collected).contains("hello") {
            break;
        }
    }

    let output = String::from_utf8_lossy(&collected);
    assert!(
        output.contains("hello"),
        "expected 'hello' in output: {output}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kill_session() {
    let id = Uuid::new_v4();
    let session = PtySession::spawn(id, "sleep", &["60"], &tmp_dir(), vec![], 80, 24).unwrap();

    assert!(!session.is_stopped());
    session.kill().await.unwrap();
    // Give the reader thread a moment to notice
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    assert!(session.is_stopped());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn output_snapshot_captures_history() {
    let id = Uuid::new_v4();
    let session =
        PtySession::spawn(id, "echo", &["snapshot_test"], &tmp_dir(), vec![], 80, 24).unwrap();

    // Wait for the process to finish and output to be captured
    let mut exit_rx = session.subscribe_exit();
    let _ = tokio::time::timeout(tokio::time::Duration::from_secs(5), exit_rx.recv()).await;

    let snapshot = session.output_snapshot();
    let text = String::from_utf8_lossy(&snapshot);
    assert!(
        text.contains("snapshot_test"),
        "expected 'snapshot_test' in snapshot: {text}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_to_session() {
    let id = Uuid::new_v4();
    let session = PtySession::spawn(id, "cat", &[], &tmp_dir(), vec![], 80, 24).unwrap();

    let mut rx = session.subscribe();

    session.write(b"ping\n").await.unwrap();

    let mut collected = Vec::new();
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(data) => collected.extend_from_slice(&data),
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Err(_) => continue,
                }
            }
            _ = tokio::time::sleep_until(deadline) => break,
        }
        if String::from_utf8_lossy(&collected).contains("ping") {
            break;
        }
    }

    let output = String::from_utf8_lossy(&collected);
    assert!(
        output.contains("ping"),
        "expected 'ping' in output: {output}"
    );

    session.kill().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resize_session() {
    let id = Uuid::new_v4();
    let session = PtySession::spawn(id, "sleep", &["60"], &tmp_dir(), vec![], 80, 24).unwrap();

    // resize should not error
    session.resize(120, 40).await.unwrap();

    session.kill().await.unwrap();
}
