use std::{
    env,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WindowEvent};

/// Window label for the Cockpit, declared in `tauri.conf.json`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const COCKPIT_WINDOW_LABEL: &str = "cockpit";

/// Fixed port the Flue engine listens on. The packaged webview's base URL
/// (`ui/src/main.tsx`) and the CSP `connect-src` (`tauri.conf.json`) are pinned
/// to this port, so it is intentionally not user-overridable.
const ENGINE_PORT: &str = "3583";

/// A supervised Source Adapter: its display label, built artifact, and the env
/// switch that disables it in local diagnostics. Each adapter tails one
/// source's on-disk sessions and ingests normalized events (issue #11).
struct AdapterSpec {
    label: &'static str,
    artifact: &'static str,
    env: &'static str,
}

/// The adapters the shell supervises. All enabled by default; set the matching
/// env var to `0`/`false`/`off`/`no` to disable one.
const ADAPTERS: &[AdapterSpec] = &[
    AdapterSpec { label: "Claude adapter", artifact: "dist/adapter-claude.mjs", env: "LOOPWATCH_CLAUDE_ADAPTER" },
    AdapterSpec { label: "Codex adapter", artifact: "dist/adapter-codex.mjs", env: "LOOPWATCH_CODEX_ADAPTER" },
    AdapterSpec { label: "Pi adapter", artifact: "dist/adapter-pi.mjs", env: "LOOPWATCH_PI_ADAPTER" },
];

/// A running adapter child paired with its label, for orderly shutdown logging.
struct AdapterChild {
    label: String,
    child: Child,
}

struct BackgroundProcesses {
    engine: Mutex<Option<Child>>,
    adapters: Mutex<Vec<AdapterChild>>,
}

impl BackgroundProcesses {
    /// Stop background children, reaping each process.
    ///
    /// Safe to call more than once: adapters are drained on the first call and
    /// the engine handle is taken out, so later calls (e.g. the `Drop`
    /// fallback) become no-ops.
    fn stop(&self) {
        self.stop_adapters();
        self.stop_child("Flue engine", &self.engine);
    }

    /// Terminate every supervised adapter, then clear the list so a second call
    /// (the `Drop` fallback) is a no-op.
    fn stop_adapters(&self) {
        let mut adapters = match self.adapters.lock() {
            Ok(adapters) => adapters,
            Err(poisoned) => poisoned.into_inner(),
        };
        for adapter in adapters.iter_mut() {
            terminate_child(&adapter.label, &mut adapter.child);
        }
        adapters.clear();
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
            app.manage(spawn_background_processes()?);
            Ok(())
        })
        .on_window_event(handle_window_event)
        .build(tauri::generate_context!())
        .expect("error while building Loopwatch");

    app.run(|app_handle, event| match event {
        // Clicking the dock icon (macOS "reopen") brings the hidden Cockpit back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            show_cockpit(app_handle);
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
        if window.label() == COCKPIT_WINDOW_LABEL {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("[loopwatch] failed to hide Cockpit window: {error}");
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn handle_window_event(_window: &tauri::Window, _event: &WindowEvent) {}

#[cfg(target_os = "macos")]
fn show_cockpit(app_handle: &tauri::AppHandle) {
    let Some(window) = app_handle.get_webview_window(COCKPIT_WINDOW_LABEL) else {
        return;
    };
    if let Err(error) = window.show() {
        eprintln!("[loopwatch] failed to show Cockpit window: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("[loopwatch] failed to focus Cockpit window: {error}");
    }
}

fn spawn_background_processes() -> Result<BackgroundProcesses, Box<dyn std::error::Error>> {
    let project_root = project_root()?;
    let mut engine = spawn_flue_engine(&project_root)?;
    let mut adapters: Vec<AdapterChild> = Vec::new();

    for spec in ADAPTERS {
        match spawn_adapter(&project_root, spec) {
            Ok(Some(child)) => adapters.push(AdapterChild { label: spec.label.to_string(), child }),
            Ok(None) => {}
            Err(error) => {
                // One adapter failing to start tears the whole launch down so we
                // never leave a half-supervised set of children orphaned.
                for adapter in adapters.iter_mut() {
                    terminate_child(&adapter.label, &mut adapter.child);
                }
                terminate_child("Flue engine", &mut engine);
                return Err(error);
            }
        }
    }

    Ok(BackgroundProcesses {
        engine: Mutex::new(Some(engine)),
        adapters: Mutex::new(adapters),
    })
}

fn spawn_flue_engine(project_root: &Path) -> Result<Child, Box<dyn std::error::Error>> {
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
        .env("PORT", ENGINE_PORT)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;

    thread::sleep(Duration::from_millis(250));
    if let Some(status) = child.try_wait()? {
        return Err(format!(
            "Flue engine exited during startup with status {status}. Is port {ENGINE_PORT} already in use?"
        )
        .into());
    }

    println!(
        "[loopwatch] spawned Flue engine pid={} on http://127.0.0.1:{}",
        child.id(),
        ENGINE_PORT
    );

    Ok(child)
}

fn spawn_adapter(project_root: &Path, spec: &AdapterSpec) -> Result<Option<Child>, Box<dyn std::error::Error>> {
    if !adapter_enabled(spec.env) {
        println!("[loopwatch] {} disabled by {}", spec.label, spec.env);
        return Ok(None);
    }

    let adapter_path = project_root.join(spec.artifact);
    if !adapter_path.exists() {
        return Err(format!(
            "{} artifact is missing at {}. Run `pnpm build` before launching Loopwatch.",
            spec.label,
            adapter_path.display()
        )
        .into());
    }

    let node_bin = env::var("LOOPWATCH_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let mut child = Command::new(node_bin)
        .arg(&adapter_path)
        .current_dir(project_root)
        .env("LOOPWATCH_SERVER_URL", format!("http://127.0.0.1:{ENGINE_PORT}"))
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;

    thread::sleep(Duration::from_millis(250));
    if let Some(status) = child.try_wait()? {
        return Err(format!("{} exited during startup with status {status}.", spec.label).into());
    }

    println!("[loopwatch] spawned {} pid={}", spec.label, child.id());

    Ok(Some(child))
}

fn adapter_enabled(var: &str) -> bool {
    match env::var(var) {
        Ok(value) => !matches!(value.to_ascii_lowercase().as_str(), "0" | "false" | "off" | "no"),
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
