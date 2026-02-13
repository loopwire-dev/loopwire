use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

const OUTPUT_HISTORY_MAX_BYTES: usize = 32 * 1024 * 1024;

pub struct PtySession {
    pub id: Uuid,
    master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Option<Arc<Mutex<Box<dyn Child + Send + Sync>>>>,
    tty_resize_file: Option<Arc<std::sync::Mutex<std::fs::File>>>,
    output_tx: broadcast::Sender<Vec<u8>>,
    exit_tx: broadcast::Sender<Option<u32>>,
    output_history: Arc<std::sync::Mutex<OutputHistory>>,
    stopped: Arc<std::sync::atomic::AtomicBool>,
}

struct OutputHistory {
    chunks: VecDeque<Vec<u8>>,
    total_bytes: usize,
    max_bytes: usize,
}

impl OutputHistory {
    fn new(max_bytes: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            total_bytes: 0,
            max_bytes,
        }
    }

    fn push(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        let chunk = data.to_vec();
        self.total_bytes += chunk.len();
        self.chunks.push_back(chunk);

        while self.total_bytes > self.max_bytes {
            if let Some(removed) = self.chunks.pop_front() {
                self.total_bytes = self.total_bytes.saturating_sub(removed.len());
            } else {
                break;
            }
        }
    }

    fn snapshot(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.total_bytes);
        for chunk in &self.chunks {
            out.extend_from_slice(chunk);
        }
        out
    }
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
        configure_unix_tty_echo(&*pair.master)?;

        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        cmd.cwd(working_dir);
        for (key, value) in env {
            cmd.env(key, value);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| crate::PtyError::Pty(e.to_string()))?;

        let (output_tx, _) = broadcast::channel(1024);
        let (exit_tx, _) = broadcast::channel(4);
        let output_history = Arc::new(std::sync::Mutex::new(OutputHistory::new(
            OUTPUT_HISTORY_MAX_BYTES,
        )));
        let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| crate::PtyError::Pty(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| crate::PtyError::Pty(e.to_string()))?;

        let output_tx_clone = output_tx.clone();
        let exit_tx_clone = exit_tx.clone();
        let output_history_clone = output_history.clone();
        let stopped_clone = stopped.clone();
        let child_arc = Arc::new(Mutex::new(child));
        let child_for_thread = child_arc.clone();

        let rt_handle = tokio::runtime::Handle::current();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if let Ok(mut history) = output_history_clone.lock() {
                            history.push(&buf[..n]);
                        }
                        let _ = output_tx_clone.send(buf[..n].to_vec());
                    }
                    Err(err) => {
                        if err.kind() == std::io::ErrorKind::Interrupted
                            || err.kind() == std::io::ErrorKind::WouldBlock
                        {
                            continue;
                        }

                        let child_exited = rt_handle.block_on(async {
                            let mut child = child_for_thread.lock().await;
                            match child.try_wait() {
                                Ok(Some(_)) => true,
                                Ok(None) => false,
                                Err(_) => false,
                            }
                        });

                        if child_exited {
                            break;
                        }
                    }
                }
            }
            stopped_clone.store(true, std::sync::atomic::Ordering::SeqCst);
            let exit_code = rt_handle.block_on(async {
                let mut child = child_for_thread.lock().await;
                child.wait().ok().map(|s| s.exit_code())
            });
            let _ = exit_tx_clone.send(exit_code);
        });

        Ok(Self {
            id: session_id,
            master: Some(Arc::new(Mutex::new(pair.master))),
            writer: Arc::new(Mutex::new(writer)),
            child: Some(child_arc),
            tty_resize_file: None,
            output_tx,
            exit_tx,
            output_history,
            stopped,
        })
    }

    pub fn attach_tty(
        session_id: Uuid,
        tty_path: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<Self, crate::PtyError> {
        let mut reader_file = OpenOptions::new().read(true).open(tty_path)?;
        let writer_file = OpenOptions::new().write(true).open(tty_path)?;
        let resize_file = OpenOptions::new().read(true).write(true).open(tty_path)?;

        let (output_tx, _) = broadcast::channel(1024);
        let (exit_tx, _) = broadcast::channel(4);
        let output_history = Arc::new(std::sync::Mutex::new(OutputHistory::new(
            OUTPUT_HISTORY_MAX_BYTES,
        )));
        let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));

        #[cfg(unix)]
        {
            set_tty_size(&resize_file, cols, rows)?;
        }

        let output_tx_clone = output_tx.clone();
        let exit_tx_clone = exit_tx.clone();
        let output_history_clone = output_history.clone();
        let stopped_clone = stopped.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader_file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if let Ok(mut history) = output_history_clone.lock() {
                            history.push(&buf[..n]);
                        }
                        let _ = output_tx_clone.send(buf[..n].to_vec());
                    }
                    Err(err) => {
                        if err.kind() == std::io::ErrorKind::Interrupted
                            || err.kind() == std::io::ErrorKind::WouldBlock
                        {
                            continue;
                        }
                        break;
                    }
                }
            }
            stopped_clone.store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = exit_tx_clone.send(None);
        });

        Ok(Self {
            id: session_id,
            master: None,
            writer: Arc::new(Mutex::new(Box::new(writer_file))),
            child: None,
            tty_resize_file: Some(Arc::new(std::sync::Mutex::new(resize_file))),
            output_tx,
            exit_tx,
            output_history,
            stopped,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Vec<u8>> {
        self.output_tx.subscribe()
    }

    pub fn subscribe_exit(&self) -> broadcast::Receiver<Option<u32>> {
        self.exit_tx.subscribe()
    }

    pub fn output_snapshot(&self) -> Vec<u8> {
        match self.output_history.lock() {
            Ok(history) => history.snapshot(),
            Err(_) => Vec::new(),
        }
    }

    pub async fn write(&self, data: &[u8]) -> Result<(), crate::PtyError> {
        let mut writer = self.writer.lock().await;
        writer.write_all(data)?;
        Ok(())
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), crate::PtyError> {
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
            return Ok(());
        }

        if let Some(tty_resize_file) = &self.tty_resize_file {
            #[cfg(unix)]
            {
                if let Ok(file) = tty_resize_file.lock() {
                    set_tty_size(&file, cols, rows)?;
                    return Ok(());
                }
            }
            #[cfg(not(unix))]
            {
                let _ = cols;
                let _ = rows;
                return Ok(());
            }
        }

        Ok(())
    }

    pub async fn kill(&self) -> Result<(), crate::PtyError> {
        if self.is_stopped() {
            return Ok(());
        }

        if let Some(child) = &self.child {
            let mut child = child.lock().await;
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

#[cfg(unix)]
fn configure_unix_tty_echo(master: &dyn MasterPty) -> Result<(), crate::PtyError> {
    let Some(fd) = master.as_raw_fd() else {
        return Ok(());
    };

    let mut tio = std::mem::MaybeUninit::<libc::termios>::uninit();
    // SAFETY: fd is a valid tty fd from portable-pty and tcgetattr initializes `tio` on success.
    let get_res = unsafe { libc::tcgetattr(fd, tio.as_mut_ptr()) };
    if get_res != 0 {
        return Err(crate::PtyError::Pty(format!(
            "tcgetattr failed: {}",
            std::io::Error::last_os_error()
        )));
    }

    // SAFETY: `tio` was initialized by successful tcgetattr above.
    let mut tio = unsafe { tio.assume_init() };
    tio.c_lflag &= !(libc::ECHO | libc::ECHONL);

    // SAFETY: fd and termios pointer are valid.
    let set_res = unsafe { libc::tcsetattr(fd, libc::TCSANOW, &tio) };
    if set_res != 0 {
        return Err(crate::PtyError::Pty(format!(
            "tcsetattr failed: {}",
            std::io::Error::last_os_error()
        )));
    }

    Ok(())
}

#[cfg(unix)]
fn set_tty_size(file: &std::fs::File, cols: u16, rows: u16) -> Result<(), crate::PtyError> {
    use std::os::fd::AsRawFd;

    let winsz = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };

    // SAFETY: fd is valid and ioctl is called with TIOCSWINSZ-compatible struct.
    let rc = unsafe { libc::ioctl(file.as_raw_fd(), libc::TIOCSWINSZ, &winsz) };
    if rc != 0 {
        return Err(crate::PtyError::Pty(format!(
            "ioctl(TIOCSWINSZ) failed: {}",
            std::io::Error::last_os_error()
        )));
    }

    Ok(())
}
