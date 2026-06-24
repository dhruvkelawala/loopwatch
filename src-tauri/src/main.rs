use std::{
    env,
    path::PathBuf,
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

struct EngineProcess {
    child: Mutex<Option<Child>>,
}

impl EngineProcess {
    /// Stop the Flue engine, reaping the child process.
    ///
    /// Safe to call more than once: the child handle is taken out on the first
    /// call, so later calls (e.g. the `Drop` fallback) become no-ops.
    fn stop(&self) {
        // Recover the child even if the lock is poisoned: leaving the engine
        // running would orphan it and hold port 3583 for the next launch.
        let mut child_slot = match self.child.lock() {
            Ok(slot) => slot,
            Err(poisoned) => poisoned.into_inner(),
        };
        let Some(mut child) = child_slot.take() else {
            return;
        };

        terminate_engine(&mut child);
    }
}

/// Stop the Flue engine child, preferring a graceful SIGTERM so the engine runs
/// its shutdown handler and closes the durable store cleanly. Escalates to a
/// forceful kill if the engine does not exit in time (or on non-Unix platforms,
/// where `Child::kill` is the only portable option).
fn terminate_engine(child: &mut Child) {
    #[cfg(unix)]
    {
        // SAFETY: `child.id()` is the PID of the engine we spawned; SIGTERM asks
        // Flue to flush and close its durable store before exiting.
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
                    eprintln!(
                        "[loopwatch] failed to poll Flue engine during shutdown: {error}"
                    );
                    break;
                }
            }
        }
    }

    // Non-Unix, or the engine ignored SIGTERM within the grace window: force it.
    if let Err(error) = child.kill() {
        eprintln!("[loopwatch] failed to stop Flue engine: {error}");
    }
    if let Err(error) = child.wait() {
        eprintln!("[loopwatch] failed to wait for Flue engine shutdown: {error}");
    }
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            app.manage(spawn_flue_engine()?);
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
        // An explicit quit (Cmd+Q) tears the engine down before the process exits.
        // `Drop` covers any exit path that skips this event.
        RunEvent::Exit => {
            app_handle.state::<EngineProcess>().stop();
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

fn spawn_flue_engine() -> Result<EngineProcess, Box<dyn std::error::Error>> {
    let project_root = project_root()?;
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
        .current_dir(&project_root)
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

    Ok(EngineProcess {
        child: Mutex::new(Some(child)),
    })
}

fn project_root() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "src-tauri has no parent project root".into())
}
