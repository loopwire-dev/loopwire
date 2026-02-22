#[cfg(unix)]
use portable_pty::MasterPty;

#[cfg(unix)]
pub(crate) fn configure_unix_tty_echo(master: &dyn MasterPty) -> Result<(), crate::PtyError> {
    let Some(fd) = master.as_raw_fd() else {
        return Ok(());
    };

    let mut tio = std::mem::MaybeUninit::<libc::termios>::uninit();
    // SAFETY: fd is a valid tty fd from portable-pty and tcgetattr initializes `tio` on success.
    let get_res = unsafe { libc::tcgetattr(fd, tio.as_mut_ptr()) };
    if get_res != 0 {
        let err = std::io::Error::last_os_error();
        tracing::warn!("tcgetattr failed: {err}");
        return Err(crate::PtyError::Pty(format!("tcgetattr failed: {err}")));
    }

    // SAFETY: `tio` was initialized by successful tcgetattr above.
    let mut tio = unsafe { tio.assume_init() };
    tio.c_lflag &= !(libc::ECHO | libc::ECHONL);

    // SAFETY: fd and termios pointer are valid.
    let set_res = unsafe { libc::tcsetattr(fd, libc::TCSANOW, &tio) };
    if set_res != 0 {
        let err = std::io::Error::last_os_error();
        tracing::warn!("tcsetattr failed: {err}");
        return Err(crate::PtyError::Pty(format!("tcsetattr failed: {err}")));
    }

    Ok(())
}
