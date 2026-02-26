use crate::activity::{
    ActivityTiming, AgentActivity, AgentActivityEvent, AgentActivityPhase, SessionActivityState,
};
use crate::manager::session::AgentHandle;
use crate::prompt::has_prompt_hint;
use lw_pty::PtySession;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct ActivityRecorder {
    pub activity_states: Arc<RwLock<HashMap<Uuid, SessionActivityState>>>,
    pub activity_events_tx: broadcast::Sender<AgentActivityEvent>,
    pub activity_timing: ActivityTiming,
}

impl ActivityRecorder {
    pub fn new(
        activity_states: Arc<RwLock<HashMap<Uuid, SessionActivityState>>>,
        activity_events_tx: broadcast::Sender<AgentActivityEvent>,
        activity_timing: ActivityTiming,
    ) -> Self {
        Self {
            activity_states,
            activity_events_tx,
            activity_timing,
        }
    }

    async fn with_state<F>(&self, session_id: Uuid, reason: &str, f: F)
    where
        F: FnOnce(&mut SessionActivityState) -> bool,
    {
        let now = chrono::Utc::now();
        let activity_event = {
            let mut states = self.activity_states.write().await;
            let state = states
                .entry(session_id)
                .or_insert_with(|| SessionActivityState::new_unknown(now, reason));
            if f(state) {
                Some(state.snapshot())
            } else {
                None
            }
        };
        if let Some(activity) = activity_event {
            self.emit_activity(session_id, activity);
        }
    }

    pub async fn record_input(&self, session_id: Uuid, bytes: &[u8]) {
        let now = chrono::Utc::now();
        let bytes = bytes.to_vec();
        self.with_state(session_id, "input_observed", move |state| {
            state.on_input(now, &bytes)
        })
        .await;
    }

    pub async fn record_output(&self, session_id: Uuid, bytes: &[u8]) {
        let now = chrono::Utc::now();
        let prompt_hint = has_prompt_hint(bytes);
        self.with_state(session_id, "output_observed", move |state| {
            state.on_output(now, prompt_hint)
        })
        .await;
    }

    pub async fn record_tick(&self, session_id: Uuid) {
        let now = chrono::Utc::now();
        let timing = self.activity_timing;
        let activity_event = {
            let mut states = self.activity_states.write().await;
            let Some(state) = states.get_mut(&session_id) else {
                return;
            };
            if state.on_tick(now, timing) {
                Some(state.snapshot())
            } else {
                None
            }
        };
        if let Some(activity) = activity_event {
            self.emit_activity(session_id, activity);
        }
    }

    pub async fn record_stopped(&self, session_id: Uuid, reason: &str) {
        let now = chrono::Utc::now();
        let reason = reason.to_string();
        let reason_clone = reason.clone();
        self.with_state(session_id, &reason, move |state| {
            state.on_session_stopped(now, &reason_clone)
        })
        .await;
    }

    fn emit_activity(&self, session_id: Uuid, activity: AgentActivity) {
        let _ = self.activity_events_tx.send(AgentActivityEvent {
            session_id,
            activity,
        });
    }

    pub async fn ensure_activity_state(
        &self,
        session_id: Uuid,
        now: chrono::DateTime<chrono::Utc>,
        reason: &str,
    ) {
        self.activity_states
            .write()
            .await
            .entry(session_id)
            .or_insert_with(|| SessionActivityState::new_unknown(now, reason));
    }

    pub async fn activity_snapshot_for_handle(
        &self,
        session_id: Uuid,
        is_running: bool,
    ) -> AgentActivity {
        if !is_running {
            return AgentActivity {
                phase: AgentActivityPhase::Unknown,
                is_idle: false,
                updated_at: chrono::Utc::now(),
                last_input_at: None,
                last_output_at: None,
                reason: "session_not_running".to_string(),
            };
        }

        self.activity_snapshot(session_id, "activity_snapshot")
            .await
    }

    pub async fn activity_snapshot(&self, session_id: Uuid, reason: &str) -> AgentActivity {
        let now = chrono::Utc::now();
        let mut states = self.activity_states.write().await;
        let state = states
            .entry(session_id)
            .or_insert_with(|| SessionActivityState::new_unknown(now, reason));
        state.snapshot()
    }

    pub async fn ensure_activity_monitor(
        &self,
        session_id: Uuid,
        session: Arc<PtySession>,
        activity_monitors: &Arc<RwLock<HashMap<Uuid, JoinHandle<()>>>>,
        handles: &Arc<RwLock<HashMap<Uuid, AgentHandle>>>,
    ) {
        let recorder = self.clone();
        let handles = Arc::clone(handles);
        let mut output_rx = session.subscribe();
        let mut exit_rx = session.subscribe_exit();
        let mut tick = tokio::time::interval(Duration::from_millis(250));
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    output = output_rx.recv() => {
                        match output {
                            Ok(data) => {
                                recorder.record_output(session_id, &data).await;
                            }
                            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                                tracing::warn!(
                                    session_id = %session_id,
                                    skipped,
                                    "activity recorder lagged"
                                );
                            }
                            Err(broadcast::error::RecvError::Closed) => break,
                        }
                    }
                    exit = exit_rx.recv() => {
                        match exit {
                            Ok(_) | Err(broadcast::error::RecvError::Closed) => {
                                recorder.record_stopped(session_id, "session_exit").await;
                                {
                                    let mut w = handles.write().await;
                                    if let Some(handle) = w.get_mut(&session_id) {
                                        handle.status = super::session::AgentStatus::Stopped;
                                        handle.process_id = None;
                                        // If the session was still Restored when
                                        // the process exited, the resume attempt
                                        // failed.  Mark as unresumable so the
                                        // next ensure_pty_attached starts fresh.
                                        if handle.status == super::session::AgentStatus::Restored
                                            && handle.resumability_status
                                                == super::session::ResumabilityStatus::Resumable
                                        {
                                            handle.resumability_status =
                                                super::session::ResumabilityStatus::Unresumable;
                                            handle.resume_failure_reason = Some(
                                                "Previous conversation could not be resumed \
                                                 — started a fresh session"
                                                    .into(),
                                            );
                                        }
                                    }
                                }
                                break;
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => {}
                        }
                    }
                    _ = tick.tick() => {
                        recorder.record_tick(session_id).await;
                    }
                }
            }
        });

        if let Some(old_task) = activity_monitors.write().await.insert(session_id, task) {
            old_task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::ActivityTiming;

    fn make_recorder() -> ActivityRecorder {
        let (tx, _rx) = broadcast::channel(64);
        ActivityRecorder::new(
            Arc::new(RwLock::new(HashMap::new())),
            tx,
            ActivityTiming::default(),
        )
    }

    #[tokio::test]
    async fn record_input_creates_state() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        recorder.record_input(id, b"hello\n").await;
        let states = recorder.activity_states.read().await;
        assert!(states.contains_key(&id));
        let snapshot = states[&id].snapshot();
        assert!(snapshot.last_input_at.is_some());
    }

    #[tokio::test]
    async fn record_output_creates_state() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        recorder.record_output(id, b"output data").await;
        let states = recorder.activity_states.read().await;
        assert!(states.contains_key(&id));
        let snapshot = states[&id].snapshot();
        assert!(snapshot.last_output_at.is_some());
    }

    #[tokio::test]
    async fn record_stopped_sets_unknown_phase() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        recorder.record_input(id, b"cmd\n").await;
        recorder.record_stopped(id, "exit").await;
        let snapshot = recorder.activity_snapshot(id, "check").await;
        assert_eq!(snapshot.phase, AgentActivityPhase::Unknown);
    }

    #[tokio::test]
    async fn record_tick_no_entry_does_nothing() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        recorder.record_tick(id).await;
        let states = recorder.activity_states.read().await;
        assert!(!states.contains_key(&id));
    }

    #[tokio::test]
    async fn ensure_activity_state_creates_entry() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        let now = chrono::Utc::now();
        recorder.ensure_activity_state(id, now, "init").await;
        let states = recorder.activity_states.read().await;
        assert!(states.contains_key(&id));
    }

    #[tokio::test]
    async fn activity_snapshot_lazy_init() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        let snapshot = recorder.activity_snapshot(id, "lazy").await;
        assert_eq!(snapshot.phase, AgentActivityPhase::Unknown);
        assert_eq!(snapshot.reason, "lazy");
    }

    #[tokio::test]
    async fn activity_snapshot_for_handle_not_running() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        let snapshot = recorder.activity_snapshot_for_handle(id, false).await;
        assert_eq!(snapshot.phase, AgentActivityPhase::Unknown);
        assert_eq!(snapshot.reason, "session_not_running");
    }

    #[tokio::test]
    async fn activity_snapshot_for_handle_running() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        recorder.record_output(id, b"data").await;
        let snapshot = recorder.activity_snapshot_for_handle(id, true).await;
        assert!(snapshot.last_output_at.is_some());
    }

    #[tokio::test]
    async fn emit_activity_sends_event() {
        let (tx, mut rx) = broadcast::channel(64);
        let recorder = ActivityRecorder::new(
            Arc::new(RwLock::new(HashMap::new())),
            tx,
            ActivityTiming::default(),
        );
        let id = Uuid::new_v4();
        let activity = AgentActivity::unknown("test", chrono::Utc::now());
        recorder.emit_activity(id, activity.clone());
        let event = rx.recv().await.unwrap();
        assert_eq!(event.session_id, id);
        assert_eq!(event.activity.reason, "test");
    }

    #[tokio::test]
    async fn record_output_with_prompt_hint_sets_awaiting_user() {
        let recorder = make_recorder();
        let id = Uuid::new_v4();
        // A prompt hint like "$ " at the end triggers AwaitingUser
        recorder.record_output(id, b"$ ").await;
        let snapshot = recorder.activity_snapshot(id, "check").await;
        assert_eq!(snapshot.phase, AgentActivityPhase::AwaitingUser);
    }
}
