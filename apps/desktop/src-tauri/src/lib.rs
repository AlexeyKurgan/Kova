mod editor;

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
struct CoreState(Mutex<Option<CommandChild>>);

fn core_is_listening() -> bool {
    let addr: SocketAddr = "127.0.0.1:8765".parse().expect("valid core address");
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn kova_data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("KovaHub")
}

fn load_or_create_token() -> String {
    let path = kova_data_dir().join("core-token.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(token) = value.get("token").and_then(|item| item.as_str()) {
                if !token.trim().is_empty() {
                    return token.to_string();
                }
            }
        }
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let body = serde_json::json!({ "token": token });
    let _ = std::fs::write(
        &path,
        serde_json::to_string_pretty(&body).unwrap_or_else(|_| "{}".to_string()),
    );
    token
}

#[tauri::command]
fn core_token() -> Result<String, String> {
    Ok(load_or_create_token())
}

fn start_core(app: &tauri::AppHandle) {
    if core_is_listening() {
        return;
    }
    let token = load_or_create_token();
    let shell = app.shell();
    let command = match shell.sidecar("kova-core") {
        Ok(command) => command.args([
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
            "--token",
            token.as_str(),
        ]),
        Err(error) => {
            eprintln!("kova-core sidecar unavailable: {error}");
            return;
        }
    };
    match command.spawn() {
        Ok((_events, child)) => {
            if let Some(state) = app.try_state::<CoreState>() {
                if let Ok(mut slot) = state.0.lock() {
                    *slot = Some(child);
                }
            }
        }
        Err(error) => eprintln!("failed to start kova-core sidecar: {error}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(editor::EditorState::default())
        .manage(CoreState::default())
        .setup(|app| {
            start_core(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            editor::editor_status,
            editor::editor_install,
            editor::editor_install_extensions,
            editor::editor_uninstall_extensions,
            editor::editor_open,
            editor::editor_close,
            editor::open_project_folder,
            core_token
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kova Hub")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => {
                editor::shutdown(app);
                if let Some(state) = app.try_state::<CoreState>() {
                    if let Ok(mut slot) = state.0.lock() {
                        if let Some(child) = slot.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
            _ => {}
        });
}
