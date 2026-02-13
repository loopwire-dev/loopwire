use clap::{Parser, Subcommand};
use lw_api::auth::{load_or_create_bootstrap_token, regenerate_bootstrap_token};
use lw_api::rest::health::init_start_time;
use lw_api::{build_router, AppState};
use lw_config::DaemonConfig;
use std::fs;
use std::net::SocketAddr;

#[derive(Parser)]
#[command(name = "loopwired", version, about = "Loopwire daemon")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the daemon
    Start {
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
    /// Print version
    Version,
}

fn read_pid() -> Option<u32> {
    let pid_path = DaemonConfig::pid_path();
    fs::read_to_string(&pid_path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        // Fallback: assume alive if PID file exists
        true
    }
}

fn write_pid() -> anyhow::Result<()> {
    let pid_path = DaemonConfig::pid_path();
    fs::write(&pid_path, std::process::id().to_string())?;
    Ok(())
}

fn remove_pid() {
    let pid_path = DaemonConfig::pid_path();
    let _ = fs::remove_file(&pid_path);
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

    match cli.command {
        Commands::Start { port } => {
            let mut config = DaemonConfig::load()?;
            config.port = port;

            // Check for stale PID
            if let Some(pid) = read_pid() {
                if is_process_alive(pid) {
                    anyhow::bail!(
                        "Daemon already running (PID {}). Use 'loopwired stop' first.",
                        pid
                    );
                } else {
                    tracing::warn!("Removing stale PID file for dead process {}", pid);
                    remove_pid();
                }
            }

            DaemonConfig::ensure_config_dir()?;
            write_pid()?;

            // Load or generate bootstrap token
            let (bootstrap_token, bootstrap_hash) = load_or_create_bootstrap_token();

            let frontend_url = &config.frontend_url;
            println!("Loopwire daemon starting...");
            println!();
            println!("  Open: {}/?token={}", frontend_url, bootstrap_token);
            println!();
            println!("  API:  http://{}:{}", config.host, config.port);
            println!();

            init_start_time();

            let state = AppState::new(config.clone(), bootstrap_hash)?;
            let shutdown_state = state.clone();
            let app = build_router(state);

            let addr: SocketAddr = config.bind_addr().parse()?;
            tracing::info!("Listening on {}", addr);

            let listener = tokio::net::TcpListener::bind(addr).await?;

            // Graceful shutdown on ctrl+c and SIGTERM
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
                if shutdown_state.agent_manager.tmux_enabled() {
                    tracing::info!("tmux detected; preserving agent sessions for recovery");
                } else {
                    shutdown_state.agent_manager.shutdown_all().await;
                }
                remove_pid();
            };

            axum::serve(listener, app)
                .with_graceful_shutdown(shutdown)
                .await?;

            Ok(())
        }

        Commands::Status => {
            match read_pid() {
                Some(pid) if is_process_alive(pid) => {
                    println!("Daemon is running (PID {})", pid);
                    // Try to hit health endpoint
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
                Some(pid) => {
                    println!("Daemon is not running (stale PID {})", pid);
                    remove_pid();
                }
                None => {
                    println!("Daemon is not running");
                }
            }
            Ok(())
        }

        Commands::Stop => {
            match read_pid() {
                Some(pid) if is_process_alive(pid) => {
                    println!("Stopping daemon (PID {})...", pid);
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(pid as i32, libc::SIGTERM);
                    }
                    // Wait for process to exit
                    for _ in 0..50 {
                        if !is_process_alive(pid) {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                    if is_process_alive(pid) {
                        println!("Force killing...");
                        #[cfg(unix)]
                        unsafe {
                            libc::kill(pid as i32, libc::SIGKILL);
                        }
                    }
                    remove_pid();
                    println!("Daemon stopped.");
                }
                Some(pid) => {
                    println!("Daemon not running (stale PID {}), cleaning up.", pid);
                    remove_pid();
                }
                None => {
                    println!("Daemon is not running.");
                }
            }
            Ok(())
        }

        Commands::Token => {
            DaemonConfig::ensure_config_dir()?;
            let token = regenerate_bootstrap_token();
            println!("{}", token);
            let config = DaemonConfig::load()?;
            if let Some(pid) = read_pid() {
                if is_process_alive(pid) {
                    println!("\nOpen: {}/?token={}", config.frontend_url, token);
                    println!("\nNote: restart the daemon for the new token to take effect.");
                }
            }
            Ok(())
        }

        Commands::Version => {
            println!("loopwired {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
    }
}
