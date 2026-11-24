mod editor;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(editor::EditorState::default())
        .invoke_handler(tauri::generate_handler![
            editor::editor_status,
            editor::editor_install,
            editor::editor_install_extensions,
            editor::editor_uninstall_extensions,
            editor::editor_open,
            editor::editor_close,
            editor::editor_open_external,
            editor::vscode_status,
            editor::open_project_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kova Hub")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => editor::shutdown(app),
            _ => {}
        });
}
