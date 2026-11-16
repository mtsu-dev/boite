//! The mobile app is a remote client: the core runs on the user's computer or
//! server, and this process only hosts the webview that speaks to it.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("the Boite app could not start");
}
