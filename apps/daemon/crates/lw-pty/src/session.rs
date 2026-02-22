use crate::history::OutputHistory;
use crate::reader::{create_session_channels, spawn_reader_thread, ReaderThreadContext};
use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

pub struct PtySession {
    pub id: Uuid,
    pub child_pid: Option<u32>,
    master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Option<Arc<std::sync::Mutex<Box<dyn Child + Send + Sync>>>>,
    output_tx: broadcast::Sender<Vec<u8>>,
    exit_tx: broadcast::Sender<Option<u32>>,
    output_history: Arc<std::sync::Mutex<OutputHistory>>,
    // std::sync::atomic is used here instead of tokio::sync because `is_stopped()` is called
    // from both sync and async contexts (including the reader thread).
    stopped: Arc<std::sync::atomic::AtomicBool>,
}

impl PtySession {
    pub fn spawn(
        session_id: Uuid,
        program: &str,
        args: &[&str],
        working_dir: &Path,
        env: Vec<(String, String)>,
        cols: u16,
        rows: u16,
    ) -> Result<Self, crate::PtyError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| crate::PtyError::Pty(e.to_string()))?;

        #[cfg(unix)]
        crate::platform::configure_unix_tty_echo(&*pair.master)?;

        let mut cmd = portable_pty::CommandBuilder::new(program);
        cmd.args(args);
        cmd.cwd(working_dir);
        for (key, value) in env {
            cmd.env(key, value);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| crate::PtyError::Pty(e.to_string()))?;

        let channels = create_session_channels();

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| crate::PtyError::Pty(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| crate::PtyError::Pty(e.to_string()))?;

        let child_pid = child.process_id();
        let child_arc = Arc::new(std::sync::Mutex::new(child));

        spawn_reader_thread(ReaderThreadContext {
            reader,
            output_tx: channels.output_tx.clone(),
            exit_tx: channels.exit_tx.clone(),
            output_history: channels.output_history.clone(),
            stopped: channels.stopped.clone(),
            child: Some(child_arc.clone()),
            session_id,
        });

        tracing::info!(session_id = %session_id, program, "PTY session spawned");

        Ok(Self {
            id: session_id,
            child_pid,
            master: Some(Arc::new(Mutex::new(pair.master))),
            writer: Arc::new(Mutex::new(writer)),
            child: Some(child_arc),
            output_tx: channels.output_tx,
            exit_tx: channels.exit_tx,
            output_history: channels.output_history,
            stopped: channels.stopped,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Vec<u8>> {
        self.output_tx.subscribe()
    }

    pub fn subscribe_exit(&self) -> broadcast::Receiver<Option<u32>> {
        self.exit_tx.subscribe()
    }

    pub fn seed_history(&self, data: &[u8]) {
        if let Ok(mut history) = self.output_history.lock() {
            history.push(data);
        }
    }

    pub fn output_snapshot(&self) -> Vec<u8> {
        match self.output_history.lock() {
            Ok(history) => history.snapshot(),
            Err(_) => Vec::new(),
        }
    }

    pub fn output_snapshot_chunked(&self, max_chunk_bytes: usize) -> Vec<Vec<u8>> {
        match self.output_history.lock() {
            Ok(history) => history.snapshot_chunked(max_chunk_bytes),
            Err(_) => Vec::new(),
        }
    }

    pub fn output_slice_before(
        &self,
        before_offset: Option<usize>,
        max_bytes: usize,
    ) -> (Vec<u8>, usize, usize, bool) {
        match self.output_history.lock() {
            Ok(history) => {
                let slice = history.slice_before(before_offset, max_bytes);
                (
                    slice.data,
                    slice.start_offset,
                    slice.end_offset,
                    slice.has_more,
                )
            }
            Err(_) => (Vec::new(), 0, 0, false),
        }
    }

    pub async fn write(&self, data: &[u8]) -> Result<(), crate::PtyError> {
        tracing::trace!(session_id = %self.id, len = data.len(), "writing to PTY");
        let mut writer = self.writer.lock().await;
        writer.write_all(data)?;
        Ok(())
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), crate::PtyError> {
        tracing::debug!(session_id = %self.id, cols, rows, "resizing PTY");
        if let Some(master) = &self.master {
            let master = master.lock().await;
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| crate::PtyError::Pty(e.to_string()))?;
        }

        Ok(())
    }

    pub async fn kill(&self) -> Result<(), crate::PtyError> {
        if self.is_stopped() {
            return Ok(());
        }

        tracing::info!(session_id = %self.id, "killing PTY session");

        if let Some(child) = &self.child {
            let mut child = child.lock().unwrap_or_else(|e| e.into_inner());
            child
                .kill()
                .map_err(|e| crate::PtyError::Pty(e.to_string()))?;
        }

        self.stopped
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = self.exit_tx.send(None);
        Ok(())
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped.load(std::sync::atomic::Ordering::SeqCst)
    }
}
