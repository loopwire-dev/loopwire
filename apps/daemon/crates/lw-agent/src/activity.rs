use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentActivityPhase {
    Unknown,
    AwaitingUser,
    UserInput,
    Processing,
    StreamingOutput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentActivity {
    pub phase: AgentActivityPhase,
    pub is_idle: bool,
    pub updated_at: DateTime<Utc>,
    pub last_input_at: Option<DateTime<Utc>>,
    pub last_output_at: Option<DateTime<Utc>>,
    pub reason: String,
}

impl AgentActivity {
    pub fn unknown(reason: &str, now: DateTime<Utc>) -> Self {
        Self {
            phase: AgentActivityPhase::Unknown,
            is_idle: false,
            updated_at: now,
            last_input_at: None,
            last_output_at: None,
            reason: reason.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentActivityEvent {
    pub session_id: Uuid,
    pub activity: AgentActivity,
}

#[derive(Debug, Clone, Copy)]
pub struct ActivityTiming {
    pub idle_debounce: Duration,
    pub busy_min_hold: Duration,
    pub processing_stale: Duration,
    pub streaming_quiet_to_processing: Duration,
}

impl Default for ActivityTiming {
    fn default() -> Self {
        Self {
            idle_debounce: Duration::from_millis(1200),
            busy_min_hold: Duration::from_millis(500),
            processing_stale: Duration::from_secs(120),
            streaming_quiet_to_processing: Duration::from_millis(1500),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionActivityState {
    activity: AgentActivity,
    pending_command: bool,
    busy_since: Option<DateTime<Utc>>,
}

impl SessionActivityState {
    pub fn new_unknown(now: DateTime<Utc>, reason: &str) -> Self {
        Self {
            activity: AgentActivity::unknown(reason, now),
            pending_command: false,
            busy_since: None,
        }
    }

    pub fn snapshot(&self) -> AgentActivity {
        self.activity.clone()
    }

    pub fn on_input(&mut self, now: DateTime<Utc>, bytes: &[u8]) -> bool {
        self.activity.last_input_at = Some(now);
        let submitted = bytes.iter().any(|b| matches!(b, b'\n' | b'\r'));
        if submitted {
            self.pending_command = true;
            return self.transition(
                now,
                AgentActivityPhase::Processing,
                false,
                "command_submitted",
            );
        }

        if matches!(
            self.activity.phase,
            AgentActivityPhase::Unknown | AgentActivityPhase::AwaitingUser
        ) {
            return self.transition(now, AgentActivityPhase::UserInput, false, "input_observed");
        }
        false
    }

    pub fn on_output(&mut self, now: DateTime<Utc>, prompt_hint: bool) -> bool {
        self.activity.last_output_at = Some(now);
        if prompt_hint {
            self.pending_command = false;
            return self.transition(now, AgentActivityPhase::AwaitingUser, true, "prompt_hint");
        }

        // While the user is actively typing, output is likely just terminal
        // echo — don't override UserInput with StreamingOutput.
        if matches!(self.activity.phase, AgentActivityPhase::UserInput) {
            return false;
        }

        self.transition(
            now,
            AgentActivityPhase::StreamingOutput,
            false,
            "output_activity",
        )
    }

    pub fn on_session_stopped(&mut self, now: DateTime<Utc>, reason: &str) -> bool {
        self.pending_command = false;
        self.transition(now, AgentActivityPhase::Unknown, false, reason)
    }

    pub fn on_tick(&mut self, now: DateTime<Utc>, timing: ActivityTiming) -> bool {
        // User stopped typing — fall back to awaiting_user.
        if matches!(self.activity.phase, AgentActivityPhase::UserInput) {
            if let Some(last_input_at) = self.activity.last_input_at {
                if now.signed_duration_since(last_input_at) >= chrono_from_std(timing.idle_debounce)
                {
                    return self.transition(
                        now,
                        AgentActivityPhase::AwaitingUser,
                        true,
                        "input_idle",
                    );
                }
            }
            return false;
        }

        let Some(last_output_at) = self.activity.last_output_at else {
            return false;
        };

        let quiet_for = now.signed_duration_since(last_output_at);
        let busy_for = self
            .busy_since
            .map(|busy_since| now.signed_duration_since(busy_since));

        if self.pending_command {
            if matches!(self.activity.phase, AgentActivityPhase::StreamingOutput)
                && quiet_for >= chrono_from_std(timing.streaming_quiet_to_processing)
            {
                return self.transition(
                    now,
                    AgentActivityPhase::Processing,
                    false,
                    "awaiting_completion",
                );
            }

            // Output was received and has gone quiet — the agent likely
            // finished processing and is waiting for user input.
            if matches!(self.activity.phase, AgentActivityPhase::Processing)
                && quiet_for >= chrono_from_std(timing.idle_debounce)
                && busy_for.unwrap_or_else(chrono::Duration::zero)
                    >= chrono_from_std(timing.busy_min_hold)
            {
                self.pending_command = false;
                return self.transition(
                    now,
                    AgentActivityPhase::AwaitingUser,
                    true,
                    "idle_timeout",
                );
            }

            if let Some(last_input_at) = self.activity.last_input_at {
                if now.signed_duration_since(last_input_at)
                    >= chrono_from_std(timing.processing_stale)
                {
                    self.pending_command = false;
                    return self.transition(
                        now,
                        AgentActivityPhase::Unknown,
                        false,
                        "processing_stale",
                    );
                }
            }
            return false;
        }

        if !matches!(
            self.activity.phase,
            AgentActivityPhase::StreamingOutput | AgentActivityPhase::Processing
        ) {
            return false;
        }

        if quiet_for >= chrono_from_std(timing.idle_debounce)
            && busy_for.unwrap_or_else(chrono::Duration::zero)
                >= chrono_from_std(timing.busy_min_hold)
        {
            return self.transition(now, AgentActivityPhase::AwaitingUser, true, "idle_timeout");
        }

        false
    }

    fn transition(
        &mut self,
        now: DateTime<Utc>,
        phase: AgentActivityPhase,
        is_idle: bool,
        reason: &str,
    ) -> bool {
        let changed = self.activity.phase != phase
            || self.activity.is_idle != is_idle
            || self.activity.reason != reason;

        if is_idle {
            self.busy_since = None;
        } else if self.busy_since.is_none() {
            self.busy_since = Some(now);
        }

        if changed {
            self.activity.phase = phase;
            self.activity.is_idle = is_idle;
            self.activity.updated_at = now;
            self.activity.reason = reason.to_string();
        }

        changed
    }
}

fn chrono_from_std(duration: Duration) -> chrono::Duration {
    chrono::Duration::from_std(duration).unwrap_or_else(|_| chrono::Duration::MAX)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_activity_unknown_constructor() {
        let now = Utc::now();
        let activity = AgentActivity::unknown("test_reason", now);
        assert_eq!(activity.phase, AgentActivityPhase::Unknown);
        assert!(!activity.is_idle);
        assert_eq!(activity.updated_at, now);
        assert!(activity.last_input_at.is_none());
        assert!(activity.last_output_at.is_none());
        assert_eq!(activity.reason, "test_reason");
    }

    #[test]
    fn agent_activity_serde_roundtrip() {
        let now = Utc::now();
        let activity = AgentActivity::unknown("test", now);
        let json = serde_json::to_string(&activity).unwrap();
        let parsed: AgentActivity = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, activity);
    }

    #[test]
    fn agent_activity_phase_serde() {
        assert_eq!(
            serde_json::to_string(&AgentActivityPhase::Unknown).unwrap(),
            "\"unknown\""
        );
        assert_eq!(
            serde_json::to_string(&AgentActivityPhase::AwaitingUser).unwrap(),
            "\"awaiting_user\""
        );
        assert_eq!(
            serde_json::to_string(&AgentActivityPhase::UserInput).unwrap(),
            "\"user_input\""
        );
        assert_eq!(
            serde_json::to_string(&AgentActivityPhase::Processing).unwrap(),
            "\"processing\""
        );
        assert_eq!(
            serde_json::to_string(&AgentActivityPhase::StreamingOutput).unwrap(),
            "\"streaming_output\""
        );
    }

    #[test]
    fn agent_activity_event_serializes() {
        let now = Utc::now();
        let event = AgentActivityEvent {
            session_id: Uuid::nil(),
            activity: AgentActivity::unknown("test", now),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"session_id\""));
        assert!(json.contains("\"activity\""));
    }

    #[test]
    fn activity_timing_default() {
        let timing = ActivityTiming::default();
        assert_eq!(timing.idle_debounce, Duration::from_millis(1200));
        assert_eq!(timing.busy_min_hold, Duration::from_millis(500));
        assert_eq!(timing.processing_stale, Duration::from_secs(120));
        assert_eq!(
            timing.streaming_quiet_to_processing,
            Duration::from_millis(1500)
        );
    }

    #[test]
    fn new_unknown_state() {
        let now = Utc::now();
        let state = SessionActivityState::new_unknown(now, "init");
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::Unknown);
        assert!(!snapshot.is_idle);
        assert_eq!(snapshot.reason, "init");
    }

    #[test]
    fn newline_input_switches_to_processing() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        let changed = state.on_input(now, b"run tests\n");
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::Processing);
        assert!(!snapshot.is_idle);
        assert!(snapshot.last_input_at.is_some());
    }

    #[test]
    fn carriage_return_input_switches_to_processing() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        let changed = state.on_input(now, b"cmd\r");
        assert!(changed);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::Processing);
    }

    #[test]
    fn input_without_newline_from_unknown_switches_to_user_input() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        let changed = state.on_input(now, b"typing");
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::UserInput);
        assert!(!snapshot.is_idle);
    }

    #[test]
    fn input_without_newline_from_awaiting_user_switches_to_user_input() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        // Get into AwaitingUser via prompt hint
        state.on_output(now, true);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::AwaitingUser);

        let changed = state.on_input(now, b"typing");
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::UserInput);
        assert!(!snapshot.is_idle);
    }

    #[test]
    fn input_without_newline_from_non_unknown_no_change() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        state.on_input(now, b"cmd\n");
        assert_eq!(state.snapshot().phase, AgentActivityPhase::Processing);

        let changed = state.on_input(now, b"more typing");
        assert!(!changed);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::Processing);
    }

    #[test]
    fn output_echo_during_user_input_stays_in_user_input() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        state.on_input(now, b"typing");
        assert_eq!(state.snapshot().phase, AgentActivityPhase::UserInput);

        // PTY echo should not override UserInput
        let changed = state.on_output(now, false);
        assert!(!changed);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::UserInput);
    }

    #[test]
    fn prompt_hint_during_user_input_switches_to_awaiting() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        state.on_input(now, b"typing");
        assert_eq!(state.snapshot().phase, AgentActivityPhase::UserInput);

        // Prompt hint should still transition out of UserInput
        let changed = state.on_output(now, true);
        assert!(changed);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::AwaitingUser);
    }

    #[test]
    fn user_input_idle_transitions_to_awaiting_user() {
        let start = Utc::now();
        let mut state = SessionActivityState::new_unknown(start, "init");
        let timing = ActivityTiming {
            idle_debounce: Duration::from_millis(1000),
            busy_min_hold: Duration::from_millis(200),
            ..ActivityTiming::default()
        };
        state.on_input(start, b"typing");
        assert_eq!(state.snapshot().phase, AgentActivityPhase::UserInput);

        // Too early — should stay in UserInput
        let before = start + chrono::Duration::milliseconds(500);
        assert!(!state.on_tick(before, timing));
        assert_eq!(state.snapshot().phase, AgentActivityPhase::UserInput);

        // After debounce — should transition to AwaitingUser
        let after = start + chrono::Duration::milliseconds(1200);
        let changed = state.on_tick(after, timing);
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::AwaitingUser);
        assert!(snapshot.is_idle);
        assert_eq!(snapshot.reason, "input_idle");
    }

    #[test]
    fn prompt_hint_switches_to_idle() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        state.on_input(now, b"ls\n");
        let changed = state.on_output(now, true);
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::AwaitingUser);
        assert!(snapshot.is_idle);
    }

    #[test]
    fn output_without_prompt_hint_switches_to_streaming() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        let changed = state.on_output(now, false);
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::StreamingOutput);
        assert!(!snapshot.is_idle);
    }

    #[test]
    fn on_session_stopped() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        state.on_input(now, b"cmd\n");
        let changed = state.on_session_stopped(now, "terminated");
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::Unknown);
        assert!(!snapshot.is_idle);
        assert_eq!(snapshot.reason, "terminated");
    }

    #[test]
    fn on_tick_no_output_returns_false() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        let timing = ActivityTiming::default();
        assert!(!state.on_tick(now, timing));
    }

    #[test]
    fn on_tick_awaiting_user_returns_false() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        state.on_output(now, true);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::AwaitingUser);
        let later = now + chrono::Duration::seconds(10);
        assert!(!state.on_tick(later, ActivityTiming::default()));
    }

    #[test]
    fn busy_to_idle_requires_debounce() {
        let start = Utc::now();
        let mut state = SessionActivityState::new_unknown(start, "init");
        let timing = ActivityTiming {
            idle_debounce: Duration::from_millis(1000),
            busy_min_hold: Duration::from_millis(200),
            ..ActivityTiming::default()
        };
        state.on_output(start, false);

        let before = start + chrono::Duration::milliseconds(900);
        let changed_early = state.on_tick(before, timing);
        assert!(!changed_early);

        let after = start + chrono::Duration::milliseconds(1200);
        let changed_late = state.on_tick(after, timing);
        assert!(changed_late);
        assert!(state.snapshot().is_idle);
    }

    #[test]
    fn streaming_to_processing_on_quiet_with_pending_command() {
        let start = Utc::now();
        let mut state = SessionActivityState::new_unknown(start, "init");
        let timing = ActivityTiming {
            streaming_quiet_to_processing: Duration::from_millis(500),
            ..ActivityTiming::default()
        };
        state.on_input(start, b"cmd\n");
        state.on_output(start, false);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::StreamingOutput);

        let later = start + chrono::Duration::milliseconds(600);
        let changed = state.on_tick(later, timing);
        assert!(changed);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::Processing);
    }

    #[test]
    fn processing_stale_resets_to_unknown() {
        let start = Utc::now();
        let mut state = SessionActivityState::new_unknown(start, "init");
        // Set idle_debounce longer than processing_stale so stale path triggers first.
        let timing = ActivityTiming {
            processing_stale: Duration::from_secs(5),
            streaming_quiet_to_processing: Duration::from_millis(100),
            idle_debounce: Duration::from_secs(10),
            ..ActivityTiming::default()
        };
        state.on_input(start, b"cmd\n");
        state.on_output(start, false);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::StreamingOutput);

        // First tick: streaming → processing (quiet long enough)
        let t1 = start + chrono::Duration::milliseconds(200);
        let changed = state.on_tick(t1, timing);
        assert!(changed);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::Processing);

        // Second tick: processing stale → unknown
        let t2 = start + chrono::Duration::seconds(6);
        let changed = state.on_tick(t2, timing);
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::Unknown);
        assert_eq!(snapshot.reason, "processing_stale");
    }

    #[test]
    fn processing_idle_after_output_transitions_to_awaiting_user() {
        let start = Utc::now();
        let mut state = SessionActivityState::new_unknown(start, "init");
        let timing = ActivityTiming {
            idle_debounce: Duration::from_millis(1000),
            busy_min_hold: Duration::from_millis(200),
            streaming_quiet_to_processing: Duration::from_millis(500),
            ..ActivityTiming::default()
        };

        // Submit a command, receive output, then output stops.
        state.on_input(start, b"cmd\n");
        state.on_output(start, false);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::StreamingOutput);

        // Tick: streaming → processing (quiet for 600ms >= 500ms threshold)
        let t1 = start + chrono::Duration::milliseconds(600);
        let changed = state.on_tick(t1, timing);
        assert!(changed);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::Processing);

        // Tick: still too early for idle timeout
        let t2 = start + chrono::Duration::milliseconds(900);
        let changed = state.on_tick(t2, timing);
        assert!(!changed);
        assert_eq!(state.snapshot().phase, AgentActivityPhase::Processing);

        // Tick: quiet for 1200ms >= idle_debounce (1000ms) → awaiting_user
        let t3 = start + chrono::Duration::milliseconds(1200);
        let changed = state.on_tick(t3, timing);
        assert!(changed);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.phase, AgentActivityPhase::AwaitingUser);
        assert!(snapshot.is_idle);
        assert_eq!(snapshot.reason, "idle_timeout");
    }

    #[test]
    fn pending_command_tick_no_change_when_not_stale() {
        let start = Utc::now();
        let mut state = SessionActivityState::new_unknown(start, "init");
        let timing = ActivityTiming::default();
        state.on_input(start, b"cmd\n");

        let slightly_later = start + chrono::Duration::milliseconds(100);
        assert!(!state.on_tick(slightly_later, timing));
    }

    #[test]
    fn transition_returns_false_when_unchanged() {
        let now = Utc::now();
        let mut state = SessionActivityState::new_unknown(now, "init");
        state.on_input(now, b"cmd\n");
        let first = state.on_input(now, b"cmd2\n");
        assert!(!first);
    }

    #[test]
    fn chrono_from_std_normal() {
        let d = Duration::from_secs(5);
        let c = chrono_from_std(d);
        assert_eq!(c, chrono::Duration::seconds(5));
    }
}
