use std::{
    env,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use tauri::Manager;

struct EngineProcess {
    child: Mutex<Option<Child>>,
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(spawn_flue_engine()?);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Loopwatch");
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
