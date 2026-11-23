#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The build driver and E2E suite check this marker in the captured binary.
    std::hint::black_box(option_env!("BOITE_SHELL_BUILD_MARKER"));
    boite_shell_lib::run();
}
