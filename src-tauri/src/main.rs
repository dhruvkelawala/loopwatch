use std::{
    env,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use tauri::{Manager, RunEvent, WindowEvent};

/// Window label for the Cockpit, declared in `tauri.conf.json`.
const COCKPIT_WINDOW_LABEL: &str = "cockpit";

struct EngineProcess {
    child: Mutex<Option<Child>>,
}

impl EngineProcess {
    /// Stop the Flue engine, killing and reaping the child process.
    ///
    /// Safe to call more than once: the child handle is taken out on the first
    /// call, so later calls (e.g. the `Drop` fallback) become no-ops.
    fn stop(&self) {
        let Ok(mut child_slot) = self.child.lock() else {
            return;
        };
        let Some(mut child) = child_slot.take() else {
            return;
        };

        if let Err(error) = child.kill() {
            eprintln!("[loopwatch] failed to stop Flue engine: {error}");
        }
        if let Err(error) = child.wait() {
            eprintln!("[loopwatch] failed to wait for Flue engine shutdown: {error}");
        }
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
        .on_window_event(|window, event| {
            // Closing the Cockpit window hides it instead of quitting the app, so the
            // Flue engine keeps observing sessions in the background (ADR-0007). The
            // window is restored on dock-icon reopen; the engine is torn down only on
            // an explicit quit.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == COCKPIT_WINDOW_LABEL {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("[loopwatch] failed to hide Cockpit window: {error}");
                    }
                }
            }
        })
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
    let port = env::var("LOOPWATCH_ENGINE_PORT").unwrap_or_else(|_| "3583".to_string());
    let mut child = Command::new(node_bin)
        .arg(&server_path)
        .current_dir(&project_root)
        .env("PORT", &port)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;

    thread::sleep(Duration::from_millis(250));
    if let Some(status) = child.try_wait()? {
        return Err(format!(
            "Flue engine exited during startup with status {status}. Is port {port} already in use?"
        )
        .into());
    }

    println!(
        "[loopwatch] spawned Flue engine pid={} on http://127.0.0.1:{}",
        child.id(),
        port
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
