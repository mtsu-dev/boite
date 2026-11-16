// `tauri dev` on a desktop runs the same app in a window, for quick UI work.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    boite_mobile_lib::run();
}
