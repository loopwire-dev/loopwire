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
            let mut config = DaemonConfig::load()?;
            config.port = port;

            if let Some(pid) = read_pid(&paths) {
                if is_process_alive(pid) {
                    anyhow::bail!(
                        "Daemon already running (PID {}). Use 'loopwired stop' first.",
                        pid
                    );
                } else {
                    tracing::warn!("Removing stale PID file for dead process {}", pid);
                    remove_pid(&paths);
                }
            }

            paths.ensure_config_dir()?;
            write_pid(&paths)?;

            let (bootstrap_token, bootstrap_hash) = load_or_create_bootstrap_token(&paths);

            let frontend_url = &config.frontend_url;
            println!("Loopwire daemon starting...");
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
                Some(pid) if is_process_alive(pid) => {
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
                Some(pid) if is_process_alive(pid) => {
                    println!("Stopping daemon (PID {})...", pid);
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(pid as i32, libc::SIGTERM);
                    }
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
                    remove_pid(&paths);
                    println!("Daemon stopped.");
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
            println!("loopwired {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
    }
}
