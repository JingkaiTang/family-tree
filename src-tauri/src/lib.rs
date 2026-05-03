mod commands;
mod errors;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::create_project,
            commands::load_project,
            commands::save_project,
            commands::import_photo,
            commands::delete_photo,
            commands::gc_media,
            commands::resolve_photo_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
