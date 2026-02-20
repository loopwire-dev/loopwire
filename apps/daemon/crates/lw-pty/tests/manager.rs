#![cfg(unix)]

use lw_pty::{PtyError, PtyManager};
use std::path::PathBuf;
use uuid::Uuid;

fn tmp_dir() -> PathBuf {
    std::env::temp_dir()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn manager_create_get_kill() {
    let mgr = PtyManager::new();
    let id = Uuid::new_v4();

    let session = mgr
        .create(id, "sleep", &["60"], &tmp_dir(), vec![], 80, 24)
        .await
        .unwrap();
    assert_eq!(session.id, id);
    assert!(!session.is_stopped());

    let fetched = mgr.get(&id).await.unwrap();
    assert_eq!(fetched.id, id);

    mgr.kill(&id).await.unwrap();
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    assert!(fetched.is_stopped());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn manager_session_not_found() {
    let mgr = PtyManager::new();
    let result = mgr.get(&Uuid::new_v4()).await;
    assert!(matches!(result, Err(PtyError::SessionNotFound(_))));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn manager_reap_stopped() {
    let mgr = PtyManager::new();
    let id = Uuid::new_v4();

    // Spawn a short-lived process
    mgr.create(id, "echo", &["done"], &tmp_dir(), vec![], 80, 24)
        .await
        .unwrap();

    // Wait for it to stop
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    let reaped = mgr.reap_stopped().await;
    assert!(reaped.contains(&id), "expected {id} in reaped: {reaped:?}");

    // Should be gone from manager now
    assert!(matches!(
        mgr.get(&id).await,
        Err(PtyError::SessionNotFound(_))
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn manager_kill_all() {
    let mgr = PtyManager::new();
    let id1 = Uuid::new_v4();
    let id2 = Uuid::new_v4();

    let s1 = mgr
        .create(id1, "sleep", &["60"], &tmp_dir(), vec![], 80, 24)
        .await
        .unwrap();
    let s2 = mgr
        .create(id2, "sleep", &["60"], &tmp_dir(), vec![], 80, 24)
        .await
        .unwrap();

    mgr.kill_all().await;

    assert!(s1.is_stopped());
    assert!(s2.is_stopped());

    // Map should be cleared
    let list = mgr.list().await;
    assert!(
        list.is_empty(),
        "expected empty list after kill_all: {list:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn manager_list() {
    let mgr = PtyManager::new();
    let id1 = Uuid::new_v4();
    let id2 = Uuid::new_v4();

    mgr.create(id1, "sleep", &["60"], &tmp_dir(), vec![], 80, 24)
        .await
        .unwrap();
    mgr.create(id2, "echo", &["hi"], &tmp_dir(), vec![], 80, 24)
        .await
        .unwrap();

    // Wait a moment for echo to finish
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    let list = mgr.list().await;
    assert_eq!(list.len(), 2);

    let ids: Vec<Uuid> = list.iter().map(|(id, _)| *id).collect();
    assert!(ids.contains(&id1));
    assert!(ids.contains(&id2));

    // sleep should be running, echo should be stopped
    let sleep_entry = list.iter().find(|(id, _)| *id == id1).unwrap();
    assert!(!sleep_entry.1, "sleep should still be running");

    let echo_entry = list.iter().find(|(id, _)| *id == id2).unwrap();
    assert!(echo_entry.1, "echo should be stopped");

    mgr.kill_all().await;
}
