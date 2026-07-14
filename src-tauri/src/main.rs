mod alerting;
use std::{
    env,
    fmt::Write as FmtWrite,
    fs, io,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WindowEvent};

/// Development port kept stable so the Vite proxy can reach the engine during
/// `tauri dev`; release launches reserve an ephemeral localhost port.
const DEV_ENGINE_PORT: u16 = 3583;
const ENGINE_TOKEN_BYTES: usize = 32;

/// Env switch for disabling the supervised source-adapters child in local
/// diagnostics. Per-source switches (`LOOPWATCH_{CLAUDE,CODEX,PI}_ADAPTER`)
/// are honored inside the Node supervisor (scripts/adapter-sources.ts), which
/// inherits this process's environment.
const SOURCE_ADAPTERS_ENV: &str = "LOOPWATCH_SOURCE_ADAPTERS";
#[derive(Debug, Clone, PartialEq, Eq)]
struct EngineLaunchConfig {
    port: u16,
    token: String,
}

impl EngineLaunchConfig {
    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn allowed_hosts(&self) -> String {
        format!("127.0.0.1:{},localhost:{}", self.port, self.port)
    }
}

struct BackgroundProcesses {
    engine_config: EngineLaunchConfig,
    engine: Mutex<Option<Child>>,
    source_adapters: Mutex<Option<Child>>,
}

impl BackgroundProcesses {
    /// Stop background children, reaping each process.
    ///
    /// Safe to call more than once: adapters are drained on the first call and
    /// the engine handle is taken out, so later calls (e.g. the `Drop`
    /// fallback) become no-ops.
    fn stop(&self) {
        self.stop_child("Source adapters", &self.source_adapters);
        self.stop_child("Flue engine", &self.engine);
    }

    fn stop_child(&self, label: &str, slot: &Mutex<Option<Child>>) {
        // Recover the child even if the lock is poisoned: leaving a child
        // running would orphan it and may hold port 3583 for the next launch.
        let mut child_slot = match slot.lock() {
            Ok(slot) => slot,
            Err(poisoned) => poisoned.into_inner(),
        };
        let Some(mut child) = child_slot.take() else {
            return;
        };

        terminate_child(label, &mut child);
    }
}

/// Stop a background child, preferring a graceful SIGTERM so Node processes run
/// shutdown handlers and close durable stores cleanly. Escalates to a forceful
/// kill if the process does not exit in time (or on non-Unix platforms, where
/// `Child::kill` is the only portable option).
fn terminate_child(label: &str, child: &mut Child) {
    #[cfg(unix)]
    {
        // SAFETY: `child.id()` is the PID of the child process we spawned;
        // SIGTERM asks it to flush and exit before we escalate.
        unsafe {
            libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
        }

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(50));
                }
                Ok(None) => break,
                Err(error) => {
                    eprintln!("[loopwatch] failed to poll {label} during shutdown: {error}");
                    break;
                }
            }
        }
    }

    // Non-Unix, or the child ignored SIGTERM within the grace window: force it.
    if let Err(error) = child.kill() {
        eprintln!("[loopwatch] failed to stop {label}: {error}");
    }
    if let Err(error) = child.wait() {
        eprintln!("[loopwatch] failed to wait for {label} shutdown: {error}");
    }
}

impl Drop for BackgroundProcesses {
    fn drop(&mut self) {
        self.stop();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let processes = spawn_background_processes()?;
            let alerting_config = alerting::EngineAlertingConfig::new(
                processes.engine_config.base_url(),
                processes.engine_config.token.clone(),
            );
            create_cockpit_window(app, &processes.engine_config)?;
            app.manage(processes);
            alerting::setup_layered_alerting(app, alerting_config)?;
            Ok(())
        })
        .on_window_event(handle_window_event)
        .build(tauri::generate_context!())
        .expect("error while building Loopwatch");

    app.run(|app_handle, event| match event {
        // Clicking the dock icon (macOS "reopen") brings the hidden Cockpit back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            let session_id = app_handle
                .state::<alerting::LayeredAlertingState>()
                .last_intervention_session();
            alerting::show_cockpit_for_session(app_handle, session_id.as_deref());
        }
        // An explicit quit (Cmd+Q) tears the children down before the process exits.
        // `Drop` covers any exit path that skips this event.
        RunEvent::Exit => {
            app_handle.state::<BackgroundProcesses>().stop();
        }
        _ => {}
    });
}

/// On macOS, closing the Cockpit window hides it instead of quitting the app, so
/// the Flue engine keeps observing sessions in the background (ADR-0007); the
/// window is restored on dock-icon reopen. Other desktop platforms have no
/// reopen affordance, so closing quits normally and the engine is torn down via
/// `RunEvent::Exit` / `Drop`.
#[cfg(target_os = "macos")]
fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == alerting::COCKPIT_WINDOW_LABEL {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("[loopwatch] failed to hide Cockpit window: {error}");
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn handle_window_event(_window: &tauri::Window, _event: &WindowEvent) {}

fn build_engine_launch_config() -> Result<EngineLaunchConfig, Box<dyn std::error::Error>> {
    let port = match env::var("LOOPWATCH_ENGINE_PORT") {
        Ok(raw) => parse_engine_port(&raw)?,
        Err(_) if cfg!(debug_assertions) => DEV_ENGINE_PORT,
        Err(_) => reserve_ephemeral_loopback_port()?,
    };
    let token = match env::var("LOOPWATCH_ENGINE_TOKEN") {
        Ok(raw) if !raw.trim().is_empty() => raw.trim().to_string(),
        _ => generate_engine_token()?,
    };

    Ok(EngineLaunchConfig { port, token })
}

fn parse_engine_port(raw: &str) -> Result<u16, Box<dyn std::error::Error>> {
    let port = raw.parse::<u16>()?;
    if port == 0 {
        return Err("LOOPWATCH_ENGINE_PORT must be between 1 and 65535".into());
    }
    Ok(port)
}

fn reserve_ephemeral_loopback_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

fn generate_engine_token() -> Result<String, Box<dyn std::error::Error>> {
    let mut bytes = [0_u8; ENGINE_TOKEN_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|error| {
        io::Error::new(
            io::ErrorKind::Other,
            format!("failed to generate engine token: {error}"),
        )
    })?;

    let mut token = String::with_capacity(ENGINE_TOKEN_BYTES * 2);
    for byte in bytes {
        write!(&mut token, "{byte:02x}")?;
    }
    Ok(token)
}

/// Create the Cockpit window with the engine runtime config injected as
/// `window.__LOOPWATCH_ENGINE_CONFIG__` via an initialization script that runs
/// before any page script. A disk file cannot carry this config in release
/// builds: Tauri embeds `frontendDist` into the binary at compile time, so a
/// `loopwatch-runtime.json` written at launch is invisible to the packaged
/// webview (and the engine port/token only exist at launch).
fn create_cockpit_window(
    app: &tauri::App,
    engine_config: &EngineLaunchConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let init_script = format!(
        "window.__LOOPWATCH_ENGINE_CONFIG__ = {};",
        runtime_config_json(engine_config, cfg!(debug_assertions))
    );

    tauri::WebviewWindowBuilder::new(
        app,
        alerting::COCKPIT_WINDOW_LABEL,
        tauri::WebviewUrl::default(),
    )
    .title("Loopwatch Cockpit")
    .inner_size(1280.0, 760.0)
    .min_inner_size(760.0, 620.0)
    .initialization_script(&init_script)
    .build()?;

    Ok(())
}

/// Older builds wrote the engine token into `ui/{dist,public}/loopwatch-runtime.json`.
/// Remove any leftovers so a stale token file is never served by the Vite dev
/// server or embedded into a later `ui:build`. Best-effort: a missing file or
/// read-only tree must not block launch.
fn remove_stale_runtime_config(project_root: &Path) {
    for path in [
        project_root.join("ui/dist/loopwatch-runtime.json"),
        project_root.join("ui/public/loopwatch-runtime.json"),
    ] {
        if let Err(error) = fs::remove_file(&path) {
            if error.kind() != io::ErrorKind::NotFound {
                eprintln!(
                    "[loopwatch] failed to remove stale runtime config {}: {error}",
                    path.display()
                );
            }
        }
    }
}

fn runtime_config_json(engine_config: &EngineLaunchConfig, use_vite_proxy: bool) -> String {
    let base_url = if use_vite_proxy {
        "/api".to_string()
    } else {
        engine_config.base_url()
    };
    serde_json::json!({
        "baseUrl": base_url,
        "bearerToken": engine_config.token,
    })
    .to_string()
}

fn spawn_background_processes() -> Result<BackgroundProcesses, Box<dyn std::error::Error>> {
    let project_root = project_root()?;
    let engine_config = build_engine_launch_config()?;
    remove_stale_runtime_config(&project_root);
    let mut engine = spawn_flue_engine(&project_root, &engine_config)?;
    let source_adapters = match spawn_source_adapters(&project_root, &engine_config) {
        Ok(adapter) => adapter,
        Err(error) => {
            terminate_child("Flue engine", &mut engine);
            return Err(error);
        }
    };

    Ok(BackgroundProcesses {
        engine_config,
        engine: Mutex::new(Some(engine)),
        source_adapters: Mutex::new(source_adapters),
    })
}

fn spawn_flue_engine(
    project_root: &Path,
    engine_config: &EngineLaunchConfig,
) -> Result<Child, Box<dyn std::error::Error>> {
    let server_path = project_root.join("dist/server.mjs");
    if !server_path.exists() {
        return Err(format!(
            "Flue server artifact is missing at {}. Run `pnpm build` before launching Loopwatch.",
            server_path.display()
        )
        .into());
    }

    let node_bin = env::var("LOOPWATCH_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let mut child = Command::new(node_bin)
        .arg(&server_path)
        .current_dir(project_root)
        .env("PORT", engine_config.port.to_string())
        .env("LOOPWATCH_ENGINE_TOKEN", &engine_config.token)
        .env(
            "LOOPWATCH_ENGINE_ALLOWED_HOSTS",
            engine_config.allowed_hosts(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;

    thread::sleep(Duration::from_millis(250));
    if let Some(status) = child.try_wait()? {
        return Err(format!(
            "Flue engine exited during startup with status {status}. Is port {} already in use?",
            engine_config.port
        )
        .into());
    }

    println!(
        "[loopwatch] spawned Flue engine pid={} on {}",
        child.id(),
        engine_config.base_url()
    );

    Ok(child)
}

fn spawn_source_adapters(
    project_root: &Path,
    engine_config: &EngineLaunchConfig,
) -> Result<Option<Child>, Box<dyn std::error::Error>> {
    if !source_adapters_enabled() {
        println!("[loopwatch] Source adapters disabled by {SOURCE_ADAPTERS_ENV}");
        return Ok(None);
    }

    let adapter_path = project_root.join("dist/adapter-sources.mjs");
    if !adapter_path.exists() {
        return Err(format!(
            "Source adapter artifact is missing at {}. Run `pnpm build` before launching Loopwatch.",
            adapter_path.display()
        )
        .into());
    }

    let node_bin = env::var("LOOPWATCH_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let mut child = Command::new(node_bin)
        .arg(&adapter_path)
        .current_dir(project_root)
        .env("LOOPWATCH_SERVER_URL", engine_config.base_url())
        .env("LOOPWATCH_ENGINE_TOKEN", &engine_config.token)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;

    thread::sleep(Duration::from_millis(250));
    if let Some(status) = child.try_wait()? {
        return Err(format!("Source adapters exited during startup with status {status}.").into());
    }

    println!("[loopwatch] spawned Source adapters pid={}", child.id());

    Ok(Some(child))
}

fn source_adapters_enabled() -> bool {
    match env::var(SOURCE_ADAPTERS_ENV) {
        Ok(value) => !matches!(
            value.to_ascii_lowercase().as_str(),
            "0" | "false" | "off" | "no"
        ),
        Err(_) => true,
    }
}

fn project_root() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "src-tauri has no parent project root".into())
}
