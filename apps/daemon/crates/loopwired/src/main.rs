use clap::{Parser, Subcommand};
use loopwired::{
    is_process_alive, read_pid_file, register_mdns, remove_pid_file, write_pid_file,
    ShareStartResponse, ShareStatusResponse,
};
use lw_api::auth::{load_or_create_bootstrap_token, regenerate_bootstrap_token};
use lw_api::rest::health::init_start_time;
use lw_api::{build_router, AppState};
use lw_config::{ConfigPaths, DaemonConfig};
use std::net::SocketAddr;

#[derive(Parser)]
#[command(
    name = "loopwired",
    version = loopwired::DAEMON_VERSION,
    about = "Loopwire daemon"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the daemon in the background
    Start {
        /// Port to bind to
        #[arg(long, default_value_t = 9400)]
        port: u16,
    },
    /// Run the daemon in the foreground
    Run {
        /// Port to bind to
        #[arg(long, default_value_t = 9400)]
        port: u16,
    },
    /// Check daemon status
    Status,
    /// Stop a running daemon
    Stop,
    /// Generate a new bootstrap token
    Token,
    /// Manage remote sharing links
    Share {
        #[command(subcommand)]
        command: ShareCommands,
    },
    /// Print version
    Version,
}

#[derive(Subcommand)]
enum ShareCommands {
    /// Start remote sharing and print a connection link
    Start {
        /// Optional PIN required by new remote clients
        #[arg(long)]
        pin: Option<String>,
        /// Optional invite token TTL in seconds
        #[arg(long)]
        ttl: Option<u64>,
    },
    /// Show remote sharing status
    Status,
    /// Stop remote sharing
    Stop,
}

fn read_pid(paths: &ConfigPaths) -> Option<u32> {
    read_pid_file(&paths.pid_path())
}

fn write_pid(paths: &ConfigPaths) -> anyhow::Result<()> {
    write_pid_file(&paths.pid_path())
}

fn remove_pid(paths: &ConfigPaths) {
    remove_pid_file(&paths.pid_path());
}

fn pid_looks_like_loopwired(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let comm_output = std::process::Command::new("ps")
            .arg("-p")
            .arg(pid.to_string())
            .arg("-o")
            .arg("comm=")
            .output();

        let comm_matches = match comm_output {
            Ok(out) if out.status.success() => {
                let comm = String::from_utf8_lossy(&out.stdout)
                    .trim()
                    .to_ascii_lowercase();
                comm.ends_with("loopwired")
            }
            _ => false,
        };

        if !comm_matches {
            return false;
        }

        let args_output = std::process::Command::new("ps")
            .arg("-p")
            .arg(pid.to_string())
            .arg("-o")
            .arg("args=")
            .output();

        match args_output {
            Ok(out) if out.status.success() => {
                let args = String::from_utf8_lossy(&out.stdout)
                    .trim()
                    .to_ascii_lowercase();
                let exe = args.split_whitespace().next().unwrap_or_default();
                exe.ends_with("/loopwired") || exe == "loopwired"
            }
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

#[cfg(unix)]
fn send_signal(pid: u32, signal: i32) -> anyhow::Result<()> {
    let raw_pid = i32::try_from(pid).map_err(|_| anyhow::anyhow!("PID out of range: {}", pid))?;
    // Safety: `raw_pid` is validated as a positive process id for libc::kill.
    let rc = unsafe { libc::kill(raw_pid, signal) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn try_start_via_launchctl() -> anyhow::Result<bool> {
    let home = match std::env::var("HOME") {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    let plist = format!("{home}/Library/LaunchAgents/dev.loopwire.loopwired.plist");
    if !std::path::Path::new(&plist).exists() {
        return Ok(false);
    }

    // Safety: libc::geteuid has no preconditions and returns the effective uid.
    let uid = unsafe { libc::geteuid() };
    let domain = format!("gui/{uid}");
    let label = format!("{domain}/dev.loopwire.loopwired");

    let loaded = std::process::Command::new("launchctl")
        .arg("print")
        .arg(&label)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !loaded {
        let bootstrap_status = std::process::Command::new("launchctl")
            .arg("bootstrap")
            .arg(&domain)
            .arg(&plist)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()?;
        if !bootstrap_status.success() {
            tracing::debug!("launchctl bootstrap did not succeed; continuing to kickstart");
        }
    }

    let status = std::process::Command::new("launchctl")
        .arg("kickstart")
        .arg("-k")
        .arg(&label)
        .status()?;

    Ok(status.success())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "loopwired=info,lw_api=info,tower_http=info".into()),
        )
        .init();

    let cli = Cli::parse();
    let paths = ConfigPaths::new()?;

    match cli.command {
        Commands::Start { port } => {
            let config = DaemonConfig::load()?;

            if let Some(pid) = read_pid(&paths) {
                if is_process_alive(pid) {
                    if !pid_looks_like_loopwired(pid) {
                        tracing::warn!(
                            "PID file points to live non-loopwired process {}, cleaning up.",
                            pid
                        );
                        remove_pid(&paths);
                    } else {
                        anyhow::bail!(
                            "Daemon already running (PID {}). Use 'loopwired stop' first.",
                            pid
                        );
                    }
                } else {
                    tracing::warn!("Removing stale PID file for dead process {}", pid);
                    remove_pid(&paths);
                }
            }

            #[cfg(target_os = "macos")]
            {
                if std::path::Path::new(&format!(
                    "{}/Library/LaunchAgents/dev.loopwire.loopwired.plist",
                    std::env::var("HOME").unwrap_or_default()
                ))
                .exists()
                {
                    if !try_start_via_launchctl()? {
                        anyhow::bail!(
                            "Failed to start daemon via launchctl. Try: launchctl kickstart -k gui/{}/dev.loopwire.loopwired",
                            // Safety: libc::geteuid has no preconditions and returns the effective uid.
                            unsafe { libc::geteuid() }
                        );
                    }
                    let (bootstrap_token, _) = load_or_create_bootstrap_token(&paths);
                    println!("Loopwire daemon started.");
                    println!();
                    println!("  Open: {}/?token={}", config.frontend_url, bootstrap_token);
                    println!();
                    println!("  API:  http://{}:{}", config.host, config.port);
                    println!();
                    return Ok(());
                }
            }

            paths.ensure_config_dir()?;
            let (bootstrap_token, _) = load_or_create_bootstrap_token(&paths);

            let exe = std::env::current_exe()?;
            let out_log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(paths.config_dir().join("loopwired.out.log"))?;
            let err_log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(paths.config_dir().join("loopwired.err.log"))?;

            let spawn_child =
                |_detach_process_group: bool| -> std::io::Result<std::process::Child> {
                    let mut cmd = std::process::Command::new(&exe);
                    cmd.arg("run")
                        .arg("--port")
                        .arg(port.to_string())
                        .stdin(std::process::Stdio::null())
                        .stdout(out_log.try_clone()?)
                        .stderr(err_log.try_clone()?);

                    cmd.spawn()
                };

            #[cfg(unix)]
            {
                spawn_child(false)?;
            }
            #[cfg(not(unix))]
            {
                spawn_child(false)?;
            }

            println!("Loopwire daemon started.");
            println!();
            println!("  Open: {}/?token={}", config.frontend_url, bootstrap_token);
            println!();
            println!("  API:  http://{}:{}", config.host, port);
            println!();

            Ok(())
        }

        Commands::Run { port } => {
            let mut config = DaemonConfig::load()?;
            config.port = port;

            if let Some(pid) = read_pid(&paths) {
                if is_process_alive(pid) {
                    if !pid_looks_like_loopwired(pid) {
                        tracing::warn!(
                            "PID file points to live non-loopwired process {}, cleaning up.",
                            pid
                        );
                        remove_pid(&paths);
                    } else {
                        anyhow::bail!(
                            "Daemon already running (PID {}). Use 'loopwired stop' first.",
                            pid
                        );
                    }
                } else {
                    tracing::warn!("Removing stale PID file for dead process {}", pid);
                    remove_pid(&paths);
                }
            }

            paths.ensure_config_dir()?;
            write_pid(&paths)?;

            let (bootstrap_token, bootstrap_hash) = load_or_create_bootstrap_token(&paths);

            let frontend_url = &config.frontend_url;
            println!("Loopwire daemon running...");
            println!();
            println!("  Open: {}/?token={}", frontend_url, bootstrap_token);
            println!();
            println!("  API:  http://{}:{}", config.host, config.port);
            println!();

            init_start_time();

            let mdns_daemon = if config.lan.enabled && !config.host.is_loopback() {
                match register_mdns(config.port) {
                    Ok(daemon) => Some(daemon),
                    Err(e) => {
                        tracing::warn!("Failed to register mDNS service: {}", e);
                        None
                    }
                }
            } else {
                if !config.lan.enabled {
                    tracing::info!("LAN discovery disabled in config");
                } else {
                    tracing::info!("Binding to loopback; skipping mDNS registration");
                }
                None
            };

            let state = AppState::new(config.clone(), bootstrap_hash)?;
            state.agent_manager.restore_persisted_agents().await;
            let shutdown_state = state.clone();
            let app = build_router(state);

            let addr: SocketAddr = config.bind_addr().parse()?;
            tracing::info!("Listening on {}", addr);

            let listener = tokio::net::TcpListener::bind(addr).await?;

            let shutdown = async move {
                #[cfg(unix)]
                {
                    let mut terminate =
                        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                            .expect("Failed to install SIGTERM handler");
                    tokio::select! {
                        _ = tokio::signal::ctrl_c() => {}
                        _ = terminate.recv() => {}
                    }
                }
                #[cfg(not(unix))]
                {
                    tokio::signal::ctrl_c()
                        .await
                        .expect("Failed to listen for ctrl+c");
                }
                tracing::info!("Shutting down...");
                if let Some(daemon) = mdns_daemon {
                    tracing::info!("Unregistering mDNS service...");
                    let _ = daemon.shutdown();
                }
                shutdown_state.agent_manager.shutdown_all().await;
                remove_pid(&shutdown_state.paths);
            };

            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(shutdown)
            .await?;

            Ok(())
        }

        Commands::Status => {
            match read_pid(&paths) {
                Some(pid) if is_process_alive(pid) && pid_looks_like_loopwired(pid) => {
                    println!("Daemon is running (PID {})", pid);
                    let config = DaemonConfig::load()?;
                    match reqwest::get(format!("http://{}/api/v1/health", config.bind_addr())).await
                    {
                        Ok(resp) => {
                            let body: serde_json::Value = resp.json().await?;
                            println!("Version: {}", body["version"].as_str().unwrap_or("unknown"));
                            println!("Uptime: {}s", body["uptime_secs"].as_u64().unwrap_or(0));
                        }
                        Err(_) => {
                            println!("(Could not reach health endpoint)");
                        }
                    }
                }
                Some(pid) if is_process_alive(pid) => {
                    println!(
                        "PID file points to non-loopwired process {}. Cleaning stale PID file.",
                        pid
                    );
                    remove_pid(&paths);
                }
                Some(pid) => {
                    println!("Daemon is not running (stale PID {})", pid);
                    remove_pid(&paths);
                }
                None => {
                    println!("Daemon is not running");
                }
            }
            Ok(())
        }

        Commands::Stop => {
            match read_pid(&paths) {
                Some(pid) if is_process_alive(pid) && pid_looks_like_loopwired(pid) => {
                    println!("Stopping daemon (PID {})...", pid);
                    #[cfg(unix)]
                    send_signal(pid, libc::SIGTERM)?;
                    for _ in 0..50 {
                        if !is_process_alive(pid) {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                    if is_process_alive(pid) {
                        println!("Force killing...");
                        #[cfg(unix)]
                        send_signal(pid, libc::SIGKILL)?;
                    }
                    remove_pid(&paths);
                    println!("Daemon stopped.");
                }
                Some(pid) if is_process_alive(pid) => {
                    println!(
                        "Refusing to stop PID {} because it is not loopwired. Cleaning stale PID file.",
                        pid
                    );
                    remove_pid(&paths);
                }
                Some(pid) => {
                    println!("Daemon not running (stale PID {}), cleaning up.", pid);
                    remove_pid(&paths);
                }
                None => {
                    println!("Daemon is not running.");
                }
            }
            Ok(())
        }

        Commands::Token => {
            paths.ensure_config_dir()?;
            let token = regenerate_bootstrap_token(&paths);
            println!("{}", token);
            let config = DaemonConfig::load()?;
            if let Some(pid) = read_pid(&paths) {
                if is_process_alive(pid) {
                    println!("\nOpen: {}/?token={}", config.frontend_url, token);
                    println!("\nNote: restart the daemon for the new token to take effect.");
                }
            }
            Ok(())
        }

        Commands::Share { command } => {
            let config = DaemonConfig::load()?;
            let base = format!("http://127.0.0.1:{}", config.port);
            let client = reqwest::Client::new();

            match command {
                ShareCommands::Start { pin, ttl } => {
                    let resp = client
                        .post(format!("{}/api/v1/remote/share/local/start", base))
                        .json(&serde_json::json!({
                            "pin": pin,
                            "ttl_seconds": ttl,
                        }))
                        .send()
                        .await?;

                    if !resp.status().is_success() {
                        let text = resp.text().await.unwrap_or_default();
                        anyhow::bail!("Failed to start remote share: {}", text);
                    }

                    let body: ShareStartResponse = resp.json().await?;
                    println!("Remote sharing started");
                    println!("  Provider: {}", body.provider);
                    println!("  Backend:  {}", body.public_backend_url);
                    println!("  Expires:  {}", body.expires_at);
                    println!(
                        "  PIN:      {}",
                        if body.pin_required { "required" } else { "off" }
                    );
                    println!();
                    println!("Connect link:");
                    println!("{}", body.connect_url);
                }
                ShareCommands::Status => {
                    let resp = client
                        .get(format!("{}/api/v1/remote/share/local/status", base))
                        .send()
                        .await?;

                    if !resp.status().is_success() {
                        let text = resp.text().await.unwrap_or_default();
                        anyhow::bail!("Failed to get remote share status: {}", text);
                    }

                    let body: ShareStatusResponse = resp.json().await?;
                    if !body.active {
                        println!("Remote sharing is inactive");
                    } else {
                        println!("Remote sharing is active");
                        println!(
                            "  Provider: {}",
                            body.provider.unwrap_or_else(|| "unknown".to_string())
                        );
                        println!(
                            "  Backend:  {}",
                            body.public_backend_url
                                .unwrap_or_else(|| "<none>".to_string())
                        );
                        println!(
                            "  Expires:  {}",
                            body.expires_at.unwrap_or_else(|| "<none>".to_string())
                        );
                        println!(
                            "  PIN:      {}",
                            if body.pin_required { "required" } else { "off" }
                        );
                        if let Some(link) = body.connect_url {
                            println!();
                            println!("Connect link:");
                            println!("{}", link);
                        }
                    }
                }
                ShareCommands::Stop => {
                    let resp = client
                        .post(format!("{}/api/v1/remote/share/local/stop", base))
                        .send()
                        .await?;

                    if !resp.status().is_success() {
                        let text = resp.text().await.unwrap_or_default();
                        anyhow::bail!("Failed to stop remote share: {}", text);
                    }

                    println!("Remote sharing stopped");
                }
            }

            Ok(())
        }

        Commands::Version => {
            println!("loopwired {}", loopwired::DAEMON_VERSION);
            Ok(())
        }
    }
}
