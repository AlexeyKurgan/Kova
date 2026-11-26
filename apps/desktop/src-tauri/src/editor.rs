use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

const CODE_SERVER_VERSION: &str = "4.146.0";
const EDITOR_WINDOW: &str = "editor";
const EDITOR_PORT: u16 = 48620;

#[derive(Default)]
pub struct EditorState {
    child: Mutex<Option<Child>>,
    url: Mutex<Option<String>>,
    installing: Mutex<bool>,
}

#[derive(Serialize)]
pub struct EditorStatus {
    installed: bool,
    running: bool,
    installing: bool,
    url: Option<String>,
    version: String,
    extensions: Vec<String>,
}

fn installed_extensions() -> Vec<String> {
    let directory = editor_root().join("extensions");
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect()
}

fn ensure_branding() -> Result<(), String> {
    let root = server_dir().join("lib").join("vscode");
    let icon = include_str!("../resources/kova-cat.svg");
    for relative in [
        "out/media/code-icon.svg",
        "out/vs/workbench/browser/media/code-icon.svg",
    ] {
        let path = root.join(relative);
        if path.is_file() {
            fs::write(path, icon).map_err(|e| e.to_string())?;
        }
    }

    let letterpress = [
        ("out/media/letterpress-dark.svg", include_str!("../resources/letterpress-dark.svg")),
        ("out/media/letterpress-light.svg", include_str!("../resources/letterpress-light.svg")),
    ];
    for (relative, svg) in letterpress {
        let path = root.join(relative);
        if path.is_file() {
            fs::write(path, svg).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn ensure_kova_chat_extension() -> Result<(), String> {
    let directory = editor_root()
        .join("extensions")
        .join("kova.kova-chat-0.3.0");
    let files: [(&str, &str); 5] = [
        (
            "package.json",
            include_str!("../resources/kova-chat-extension/package.json"),
        ),
        (
            "extension.js",
            include_str!("../resources/kova-chat-extension/extension.js"),
        ),
        (
            "chat.html",
            include_str!("../resources/kova-chat-extension/chat.html"),
        ),
        (
            "run.html",
            include_str!("../resources/kova-chat-extension/run.html"),
        ),
        (
            "media/icon.svg",
            include_str!("../resources/kova-chat-extension/media/icon.svg"),
        ),
    ];
    for (relative, content) in files {
        let target = directory.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(target, content).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = directory.parent() {
        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let text = name.to_string_lossy();
                if text.starts_with("kova.kova-chat-") && text != "kova.kova-chat-0.3.0" {
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
        let registry_path = parent.join("extensions.json");
        let mut registry: Vec<serde_json::Value> = fs::read_to_string(&registry_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        registry.retain(|entry| {
            entry
                .get("identifier")
                .and_then(|value| value.get("id"))
                .and_then(|value| value.as_str())
                != Some("kova.kova-chat")
        });
        let mut path = directory.to_string_lossy().replace('\\', "/");
        if !path.starts_with('/') {
            path.insert(0, '/');
        }
        registry.push(serde_json::json!({
            "identifier": { "id": "kova.kova-chat" },
            "version": "0.3.0",
            "location": { "$mid": 1, "path": path, "scheme": "file" },
            "relativeLocation": "kova.kova-chat-0.3.0"
        }));
        let _ = fs::write(
            registry_path,
            serde_json::to_string(&registry).unwrap_or_else(|_| "[]".to_string()),
        );
    }
    Ok(())
}

fn ensure_theme_extension() -> Result<(), String> {
    let directory = editor_root()
        .join("extensions")
        .join("kova.kova-theme-0.2.0");
    let files: [(&str, &str); 4] = [
        (
            "package.json",
            include_str!("../resources/kova-theme/package.json"),
        ),
        (
            "extension.js",
            include_str!("../resources/kova-theme/extension.js"),
        ),
        (
            "themes/kova-dark.json",
            include_str!("../resources/kova-theme/themes/kova-dark.json"),
        ),
        (
            "themes/kova-light.json",
            include_str!("../resources/kova-theme/themes/kova-light.json"),
        ),
    ];

    for (relative, content) in files {
        let path = directory.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(path, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_profile() -> Result<(), String> {
    let user_dir = editor_root().join("user-data").join("User");
    fs::create_dir_all(&user_dir).map_err(|e| e.to_string())?;
    let settings_path = user_dir.join("settings.json");
    let mut settings: serde_json::Value = if settings_path.is_file() {
        let Ok(text) = fs::read_to_string(&settings_path) else {
            return Ok(());
        };
        let Ok(value) = serde_json::from_str(&text) else {
            return Ok(());
        };
        value
    } else {
        json!({})
    };

    if let Some(target) = settings.as_object_mut() {
        let theme_version = target
            .get("kova.themeVersion")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);

        if theme_version < 2 {
            target.insert("workbench.colorTheme".to_string(), json!("Kova Dark"));
            target.insert(
                "workbench.preferredLightColorTheme".to_string(),
                json!("Kova Light"),
            );
            target.remove("workbench.colorCustomizations");
            target.remove("[Default Light Modern]");
            target.insert("kova.themeVersion".to_string(), json!(2));
        }

        let defaults = [
            ("workbench.colorTheme", json!("Kova Dark")),
            ("workbench.preferredLightColorTheme", json!("Kova Light")),
            ("window.title", json!("Kova — ${rootName}")),
            ("telemetry.telemetryLevel", json!("off")),
            ("workbench.startupEditor", json!("none")),
            ("window.autoDetectColorScheme", json!(true)),
            ("window.menuBarVisibility", json!("classic")),
            ("explorer.compactFolders", json!(false)),
            ("workbench.tree.indent", json!(16)),
            ("workbench.tree.renderIndentGuides", json!("onHover")),
        ];
        for (key, value) in defaults {
            if !target.contains_key(key) {
                target.insert(key.to_string(), value);
            }
        }
    }

    fs::write(
        settings_path,
        serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n",
    )
    .map_err(|e| e.to_string())
}

fn editor_root() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("KovaHub").join("editor")
}

fn server_dir() -> PathBuf {
    editor_root().join(format!("code-server-{CODE_SERVER_VERSION}-windows-amd64"))
}

fn server_cmd() -> PathBuf {
    server_dir().join("bin").join("code-server.cmd")
}

fn wait_ready(port: u16) -> bool {
    for _ in 0..90 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

fn is_light_theme() -> bool {
    let path = editor_root()
        .join("user-data")
        .join("User")
        .join("settings.json");
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    settings
        .get("workbench.colorTheme")
        .and_then(|value| value.as_str())
        .map(|name| name.to_lowercase().contains("light"))
        .unwrap_or(false)
}

fn encode_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn install_blocking() -> Result<(), String> {
    let root = editor_root();
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let archive = root.join("code-server.tar.gz");
    let url = format!(
        "https://github.com/coder/code-server/releases/download/v{0}/code-server-{0}-windows-amd64.tar.gz",
        CODE_SERVER_VERSION
    );

    let status = Command::new("curl.exe")
        .args(["-L", "--fail", "-sS", "-o"])
        .arg(&archive)
        .arg(&url)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("не удалось скачать редактор".to_string());
    }

    let status = Command::new("tar.exe")
        .args(["-xzf"])
        .arg(&archive)
        .arg("-C")
        .arg(&root)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("не удалось распаковать редактор".to_string());
    }
    let _ = fs::remove_file(&archive);

    if !server_cmd().is_file() {
        return Err("исполняемый файл редактора не найден после распаковки".to_string());
    }
    Ok(())
}

fn spawn_server(port: u16) -> Result<Child, String> {
    let root = editor_root();
    let user_data = root.join("user-data");
    let extensions = root.join("extensions");
    let config = root.join("config.yaml");
    fs::create_dir_all(&user_data).map_err(|e| e.to_string())?;
    fs::create_dir_all(&extensions).map_err(|e| e.to_string())?;
    ensure_theme_extension()?;
    ensure_kova_chat_extension()?;
    ensure_branding()?;
    ensure_profile()?;

    let bind = format!("127.0.0.1:{port}");
    let mut cmd = Command::new("cmd.exe");
    cmd.arg("/C")
        .arg(server_cmd())
        .args(["--bind-addr", &bind])
        .args(["--auth", "none"])
        .arg("--disable-telemetry")
        .arg("--disable-update-check")
        .arg("--disable-workspace-trust")
        .arg("--disable-getting-started-override")
        .arg("--config")
        .arg(&config)
        .arg("--user-data-dir")
        .arg(&user_data)
        .arg("--extensions-dir")
        .arg(&extensions)
        .args(["--app-name", "Kova Editor"])
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    cmd.spawn().map_err(|e| e.to_string())
}

fn open_window(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(EDITOR_WINDOW) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let parsed = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    let mut builder = WebviewWindowBuilder::new(app, EDITOR_WINDOW, WebviewUrl::External(parsed))
        .title("Kova — Редактор")
        .inner_size(1280.0, 860.0)
        .decorations(false)
        .shadow(true)
        .initialization_script(include_str!("../resources/editor-chrome.js"));
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).map_err(|e| e.to_string())?;
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = window.set_decorations(false);
    let _ = window.set_shadow(true);
    let light = is_light_theme();
    let _ = window.set_theme(Some(if light {
        tauri::Theme::Light
    } else {
        tauri::Theme::Dark
    }));

    let close_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            shutdown(&close_handle);
        }
    });

    let chrome = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        let _ = chrome.eval(include_str!("../resources/editor-chrome.js"));
    });
    Ok(())
}

pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<EditorState>();
    if let Some(mut child) = state.child.lock().unwrap().take() {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(0x0800_0000)
                .status();
        }
        #[cfg(not(windows))]
        {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
    *state.url.lock().unwrap() = None;
}

#[tauri::command]
pub fn editor_status(state: State<'_, EditorState>) -> EditorStatus {
    let current_url = state.url.lock().unwrap().clone();
    let installing = *state.installing.lock().unwrap();
    EditorStatus {
        installed: server_cmd().is_file(),
        running: current_url.is_some(),
        installing,
        url: current_url,
        version: CODE_SERVER_VERSION.to_string(),
        extensions: installed_extensions(),
    }
}

#[tauri::command]
pub async fn editor_uninstall_extensions(ids: Vec<String>) -> Result<usize, String> {
    if !server_cmd().is_file() {
        return Err("редактор не установлен".to_string());
    }
    if ids.is_empty() {
        return Ok(0);
    }

    let root = editor_root();
    let user_data = root.join("user-data");
    let extensions = root.join("extensions");
    let config = root.join("config.yaml");

    tauri::async_runtime::spawn_blocking(move || {
        let mut removed = 0;
        for id in ids {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/C")
                .arg(server_cmd())
                .arg("--uninstall-extension")
                .arg(&id)
                .arg("--user-data-dir")
                .arg(&user_data)
                .arg("--extensions-dir")
                .arg(&extensions)
                .arg("--config")
                .arg(&config)
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            let status = cmd.status().map_err(|e| e.to_string())?;
            if !status.success() {
                return Err(format!("не удалось удалить {id}"));
            }
            removed += 1;
        }
        Ok::<usize, String>(removed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn editor_install_extensions(ids: Vec<String>) -> Result<usize, String> {
    if !server_cmd().is_file() {
        return Err("редактор не установлен".to_string());
    }
    if ids.is_empty() {
        return Ok(0);
    }

    let root = editor_root();
    let user_data = root.join("user-data");
    let extensions = root.join("extensions");
    let config = root.join("config.yaml");

    tauri::async_runtime::spawn_blocking(move || {
        let mut installed = 0;
        for id in ids {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/C")
                .arg(server_cmd())
                .arg("--install-extension")
                .arg(&id)
                .arg("--force")
                .arg("--user-data-dir")
                .arg(&user_data)
                .arg("--extensions-dir")
                .arg(&extensions)
                .arg("--config")
                .arg(&config)
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            let status = cmd.status().map_err(|e| e.to_string())?;
            if !status.success() {
                return Err(format!("не удалось установить {id}"));
            }
            installed += 1;
        }
        Ok::<usize, String>(installed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn editor_install(state: State<'_, EditorState>) -> Result<(), String> {
    if *state.installing.lock().unwrap() {
        return Err("установка уже идёт".to_string());
    }
    *state.installing.lock().unwrap() = true;
    let result = tauri::async_runtime::spawn_blocking(install_blocking)
        .await
        .map_err(|e| e.to_string())?;
    *state.installing.lock().unwrap() = false;
    result
}

#[tauri::command]
pub fn editor_open(
    app: tauri::AppHandle,
    state: State<'_, EditorState>,
    project_path: String,
) -> Result<String, String> {
    if !server_cmd().is_file() {
        return Err("редактор не установлен".to_string());
    }
    let existing_url = state.url.lock().unwrap().clone();
    if let Some(url) = existing_url {
        open_window(&app, &url)?;
        return Ok(url);
    }

    let port = EDITOR_PORT;
    let child = spawn_server(port)?;
    *state.child.lock().unwrap() = Some(child);

    let normalized = project_path.replace('\\', "/");
    let folder = if normalized.len() >= 2 && normalized.as_bytes().get(1) == Some(&b':') {
        format!("/{normalized}")
    } else {
        normalized
    };
    let url = format!(
        "http://127.0.0.1:{port}/?folder={}",
        encode_component(&folder)
    );
    *state.url.lock().unwrap() = Some(url.clone());

    let handle = app.clone();
    let window_url = url.clone();
    std::thread::spawn(move || {
        if wait_ready(port) {
            let inner = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let _ = open_window(&inner, &window_url);
            });
        } else {
            shutdown(&handle);
        }
    });

    Ok(url)
}

#[tauri::command]
pub fn editor_close(app: tauri::AppHandle) {
    shutdown(&app);
    if let Some(window) = app.get_webview_window(EDITOR_WINDOW) {
        let _ = window.close();
    }
}

#[tauri::command]
pub fn open_project_folder(path: String) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
