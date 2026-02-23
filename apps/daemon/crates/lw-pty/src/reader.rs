use crate::history::{OutputHistory, OUTPUT_HISTORY_MAX_BYTES};
use portable_pty::Child;
use std::io::Read;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

/// Channels and shared state created for each PTY session.
pub(crate) struct SessionChannels {
    pub output_tx: broadcast::Sender<Vec<u8>>,
    pub exit_tx: broadcast::Sender<Option<u32>>,
    pub output_history: Arc<std::sync::Mutex<OutputHistory>>,
    pub stopped: Arc<std::sync::atomic::AtomicBool>,
}

pub(crate) fn create_session_channels() -> SessionChannels {
    let (output_tx, _) = broadcast::channel(4096);
    let (exit_tx, _) = broadcast::channel(4);
    let output_history = Arc::new(std::sync::Mutex::new(OutputHistory::new(
        OUTPUT_HISTORY_MAX_BYTES,
    )));
    let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
    SessionChannels {
        output_tx,
        exit_tx,
        output_history,
        stopped,
    }
}

/// Context for the reader thread. The `child` field controls the two modes:
/// - `Some(child)` for `spawn()`: does `try_wait`/`wait` on read errors and collects exit code.
/// - `None` for `attach_tty()`: breaks on read error and sends `None` exit code.
pub(crate) struct ReaderThreadContext {
    pub reader: Box<dyn Read + Send>,
    pub output_tx: broadcast::Sender<Vec<u8>>,
    pub exit_tx: broadcast::Sender<Option<u32>>,
    pub output_history: Arc<std::sync::Mutex<OutputHistory>>,
    pub stopped: Arc<std::sync::atomic::AtomicBool>,
    pub child: Option<Arc<std::sync::Mutex<Box<dyn Child + Send + Sync>>>>,
    pub session_id: Uuid,
}

pub(crate) fn spawn_reader_thread(ctx: ReaderThreadContext) {
    let thread_name = format!("pty-reader-{}", ctx.session_id);
    std::thread::Builder::new()
        .name(thread_name)
        .spawn(move || {
            tracing::debug!(session_id = %ctx.session_id, "reader thread started");
            run_reader_loop(ctx);
        })
        .expect("failed to spawn pty reader thread");
}

fn run_reader_loop(ctx: ReaderThreadContext) {
    let ReaderThreadContext {
        mut reader,
        output_tx,
        exit_tx,
        output_history,
        stopped,
        child,
        session_id,
    } = ctx;

    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if let Ok(mut history) = output_history.lock() {
                    history.push(&buf[..n]);
                }
                let _ = output_tx.send(buf[..n].to_vec());
            }
            Err(err) => {
                if err.kind() == std::io::ErrorKind::Interrupted
                    || err.kind() == std::io::ErrorKind::WouldBlock
                {
                    continue;
                }

                if let Some(child) = &child {
                    let mut child = child.lock().unwrap_or_else(|e| e.into_inner());
                    if matches!(child.try_wait(), Ok(Some(_))) {
                        break;
                    }
                } else {
                    tracing::warn!(session_id = %session_id, error = %err, "reader error");
                    break;
                }
            }
        }
    }

    stopped.store(true, std::sync::atomic::Ordering::SeqCst);

    let exit_code = if let Some(child) = &child {
        let mut child = child.lock().unwrap_or_else(|e| e.into_inner());
        child.wait().ok().map(|s| s.exit_code())
    } else {
        None
    };

    let _ = exit_tx.send(exit_code);
    tracing::debug!(session_id = %session_id, ?exit_code, "reader thread finished");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_session_channels_output_tx_can_send() {
        let channels = create_session_channels();
        let mut rx = channels.output_tx.subscribe();
        channels.output_tx.send(vec![1, 2, 3]).unwrap();
        let received = rx.try_recv().unwrap();
        assert_eq!(received, vec![1, 2, 3]);
    }

    #[test]
    fn create_session_channels_history_starts_empty() {
        let channels = create_session_channels();
        let history = channels.output_history.lock().unwrap();
        assert!(history.snapshot().is_empty());
    }

    #[test]
    fn create_session_channels_broadcast_capacity_is_4096() {
        let channels = create_session_channels();
        // The broadcast channel should accept at least 4096 messages without lagging.
        let mut rx = channels.output_tx.subscribe();
        for i in 0..4096 {
            channels.output_tx.send(vec![i as u8]).unwrap();
        }
        // First message should still be receivable (not lagged).
        let first = rx.try_recv().unwrap();
        assert_eq!(first, vec![0u8]);
    }

    #[test]
    fn reader_thread_context_accepts_std_sync_mutex_child() {
        // Verify that ReaderThreadContext compiles with std::sync::Mutex child
        // and no rt_handle field.
        let channels = create_session_channels();
        let _ctx = ReaderThreadContext {
            reader: Box::new(std::io::empty()),
            output_tx: channels.output_tx,
            exit_tx: channels.exit_tx,
            output_history: channels.output_history,
            stopped: channels.stopped,
            child: None,
            session_id: uuid::Uuid::nil(),
        };
    }

    // ── run_reader_loop tests (via direct call — private but same module) ──

    #[test]
    fn run_reader_loop_eof_sets_stopped_and_sends_none_exit() {
        let channels = create_session_channels();
        let mut exit_rx = channels.exit_tx.subscribe();
        let ctx = ReaderThreadContext {
            reader: Box::new(std::io::empty()), // Ok(0) immediately
            output_tx: channels.output_tx,
            exit_tx: channels.exit_tx,
            output_history: channels.output_history,
            stopped: channels.stopped.clone(),
            child: None,
            session_id: uuid::Uuid::nil(),
        };

        run_reader_loop(ctx);

        assert!(channels.stopped.load(std::sync::atomic::Ordering::SeqCst));
        assert!(exit_rx.try_recv().unwrap().is_none());
    }

    #[test]
    fn run_reader_loop_data_forwarded_to_channel_and_history() {
        let channels = create_session_channels();
        let mut output_rx = channels.output_tx.subscribe();
        let ctx = ReaderThreadContext {
            reader: Box::new(std::io::Cursor::new(b"hello world".to_vec())),
            output_tx: channels.output_tx,
            exit_tx: channels.exit_tx,
            output_history: channels.output_history.clone(),
            stopped: channels.stopped.clone(),
            child: None,
            session_id: uuid::Uuid::nil(),
        };

        run_reader_loop(ctx);

        let snapshot = channels.output_history.lock().unwrap().snapshot();
        assert_eq!(snapshot, b"hello world");

        let received = output_rx.try_recv().unwrap();
        assert_eq!(received, b"hello world");

        assert!(channels.stopped.load(std::sync::atomic::Ordering::SeqCst));
    }

    /// A reader that yields a configurable error on the first call,
    /// then EOF on all subsequent calls.
    struct ErrorThenEof {
        kind: std::io::ErrorKind,
        done: bool,
    }

    impl std::io::Read for ErrorThenEof {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            if !self.done {
                self.done = true;
                Err(std::io::Error::from(self.kind))
            } else {
                Ok(0)
            }
        }
    }

    #[test]
    fn run_reader_loop_interrupted_error_is_retried() {
        // Interrupted is a transient error; the loop must continue and
        // reach EOF rather than breaking immediately.
        let channels = create_session_channels();
        let ctx = ReaderThreadContext {
            reader: Box::new(ErrorThenEof {
                kind: std::io::ErrorKind::Interrupted,
                done: false,
            }),
            output_tx: channels.output_tx,
            exit_tx: channels.exit_tx,
            output_history: channels.output_history,
            stopped: channels.stopped.clone(),
            child: None,
            session_id: uuid::Uuid::nil(),
        };

        run_reader_loop(ctx);

        // Must still reach EOF and set stopped.
        assert!(channels.stopped.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn run_reader_loop_would_block_error_is_retried() {
        let channels = create_session_channels();
        let ctx = ReaderThreadContext {
            reader: Box::new(ErrorThenEof {
                kind: std::io::ErrorKind::WouldBlock,
                done: false,
            }),
            output_tx: channels.output_tx,
            exit_tx: channels.exit_tx,
            output_history: channels.output_history,
            stopped: channels.stopped.clone(),
            child: None,
            session_id: uuid::Uuid::nil(),
        };

        run_reader_loop(ctx);

        assert!(channels.stopped.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn run_reader_loop_other_error_without_child_breaks_immediately() {
        // A non-transient error with child=None causes the loop to break.
        let channels = create_session_channels();
        let mut exit_rx = channels.exit_tx.subscribe();
        let ctx = ReaderThreadContext {
            reader: Box::new(ErrorThenEof {
                kind: std::io::ErrorKind::BrokenPipe,
                done: false,
            }),
            output_tx: channels.output_tx,
            exit_tx: channels.exit_tx,
            output_history: channels.output_history,
            stopped: channels.stopped.clone(),
            child: None,
            session_id: uuid::Uuid::nil(),
        };

        run_reader_loop(ctx);

        // Should have stopped and sent None exit code.
        assert!(channels.stopped.load(std::sync::atomic::Ordering::SeqCst));
        assert!(exit_rx.try_recv().unwrap().is_none());
    }

    #[test]
    fn spawn_reader_thread_data_arrives_and_stopped_flag_set() {
        let channels = create_session_channels();
        let mut output_rx = channels.output_tx.subscribe();
        let mut exit_rx = channels.exit_tx.subscribe();
        let ctx = ReaderThreadContext {
            reader: Box::new(std::io::Cursor::new(b"from thread".to_vec())),
            output_tx: channels.output_tx,
            exit_tx: channels.exit_tx,
            output_history: channels.output_history.clone(),
            stopped: channels.stopped.clone(),
            child: None,
            session_id: uuid::Uuid::nil(),
        };

        spawn_reader_thread(ctx);
        std::thread::sleep(std::time::Duration::from_millis(100));

        let data = output_rx.try_recv().unwrap();
        assert_eq!(data, b"from thread");
        assert!(channels.stopped.load(std::sync::atomic::Ordering::SeqCst));
        assert!(exit_rx.try_recv().unwrap().is_none());
    }
}
