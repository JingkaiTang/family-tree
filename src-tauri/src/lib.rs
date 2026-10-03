mod commands;
mod errors;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::create_project,
            commands::list_managed_projects,
            commands::load_project,
            commands::save_project,
            commands::runtime_platform,
            commands::pick_project_directory,
            commands::import_project_bundle_from_picker,
            commands::export_project_bundle_to_picker,
            commands::import_photo,
            commands::delete_photo,
            commands::gc_media,
            commands::load_photo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
