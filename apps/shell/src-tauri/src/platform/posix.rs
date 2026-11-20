use std::process::Command;
use tauri::AppHandle;

pub(crate) fn prepare_command(command: &mut Command) {
    // Finder and desktop launchers do not inherit interactive shell startup files.
    // Preserve the caller's order, then add common native CLI installation paths.
    let mut paths: Vec<_> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os("HOME") {
        let home = std::path::PathBuf::from(home);
        for relative in [".local/bin", ".bun/bin", ".cargo/bin", ".npm-global/bin"] {
            let path = home.join(relative);
            if !paths.contains(&path) { paths.push(path); }
        }
    }
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        let path = std::path::PathBuf::from(directory);
        if !paths.contains(&path) { paths.push(path); }
    }
    if let Ok(path) = std::env::join_paths(paths) { command.env("PATH", path); }
    if let Some(appdir) = std::env::var_os("APPDIR").filter(|_| std::env::var_os("APPIMAGE").is_some()) {
        for (name, value) in appimage_scrub(std::path::Path::new(&appdir), std::env::var_os("XDG_DATA_DIRS")) {
            match value { Some(value) => { command.env(name, value); } None => { command.env_remove(name); } }
        }
    }
}

/// What the AppImage runtime and its GTK hook export for the shell's own
/// WebKitGTK. The core would hand them to every agent, and a GTK program an
/// agent starts (`xdg-open`, a browser, a GUI test) would load the bundle's
/// modules and schemas against the system's libraries, from a mount that goes
/// away with the AppImage.
const APPIMAGE_ONLY: [&str; 14] = [
    "APPDIR", "APPIMAGE", "ARGV0", "OWD", "GTK_DATA_PREFIX", "GTK_THEME", "GTK_EXE_PREFIX", "GTK_PATH",
    "GTK_IM_MODULE_FILE", "GDK_PIXBUF_MODULE_FILE", "GIO_MODULE_DIR", "GSETTINGS_SCHEMA_DIR", "GI_TYPELIB_PATH",
    "LINUXDEPLOY",
];

/// The core's environment changes inside an AppImage: every variable above
/// removed, and `XDG_DATA_DIRS` without the entries inside the mount.
pub(crate) fn appimage_scrub(appdir: &std::path::Path, data_dirs: Option<std::ffi::OsString>) -> Vec<(&'static str, Option<std::ffi::OsString>)> {
    let mut changes: Vec<_> = APPIMAGE_ONLY.iter().map(|name| (*name, None)).collect();
    if let Some(dirs) = data_dirs {
        let kept: Vec<_> = std::env::split_paths(&dirs).filter(|dir| !dir.starts_with(appdir)).collect();
        changes.push(("XDG_DATA_DIRS", if kept.is_empty() { None } else { std::env::join_paths(kept).ok() }));
    }
    changes
}

/// The OS gives no session-wide idle time the shell can read everywhere here.
pub(crate) fn idle_ms() -> Option<u64> { None }

/// WebKitGTK and WKWebView offer no memory level for one page.
pub(crate) fn memory_level<R: tauri::Runtime>(_webview: &tauri::Webview<R>, _low: bool) {}

/// WebKit has no call to put a hidden page to sleep.
pub(crate) fn suspend<R: tauri::Runtime>(_webview: &tauri::Webview<R>) {}

pub(crate) fn foreground(window: &tauri::Window) -> bool {
    window.is_focused().unwrap_or(false)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agents_never_inherit_the_appimage_gtk_environment() {
        let appdir = std::path::Path::new("/tmp/.mount_BoiteAb12");
        let changes = appimage_scrub(appdir, Some("/tmp/.mount_BoiteAb12/usr/share:/usr/local/share:/usr/share".into()));
        assert!(changes.contains(&("GIO_MODULE_DIR", None)));
        assert!(changes.contains(&("APPIMAGE", None)));
        assert!(changes.contains(&("XDG_DATA_DIRS", Some("/usr/local/share:/usr/share".into()))));
        let only_bundle = appimage_scrub(appdir, Some("/tmp/.mount_BoiteAb12/usr/share".into()));
        assert!(only_bundle.contains(&("XDG_DATA_DIRS", None)));
        assert!(!appimage_scrub(appdir, None).iter().any(|(name, _)| *name == "XDG_DATA_DIRS"));
    }

    #[test]
    fn a_notification_passes_its_text_as_arguments_and_never_as_script() {
        let args = |command: &Command| command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let linux = notify_command(false, "-t \"x\"", "body; rm -rf ~");
        assert_eq!(linux.get_program(), "notify-send");
        assert_eq!(args(&linux), ["--app-name=Boite", "--", "-t \"x\"", "body; rm -rf ~"]);
        let mac = notify_command(true, "Done \"now\"", "a\\\" & do shell script \"id\"\nnext");
        assert_eq!(mac.get_program(), "osascript");
        assert_eq!(args(&mac), ["-e", r#"display notification "a\\\" & do shell script \"id\" next" with title "Done \"now\"""#]);
    }
}

/// A shell that cannot start has no window of its own, and a launch from the
/// dock or a desktop menu has no terminal: the system's own dialog says why.
/// Linux uses zenity or kdialog when one is installed; without either, the
/// log file and stderr are all there is.
pub(crate) fn alert(title: &str, text: &str) {
    eprintln!("[shell] {text}");
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("osascript");
        command.arg("-e").arg(format!("display alert {} message {} as critical", applescript_string(title), applescript_string(text)));
        command
    } else if let Some(zenity) = which("zenity") {
        let mut command = Command::new(zenity);
        command.args(["--error", "--no-markup", "--title", title, "--text", text]);
        command
    } else if let Some(kdialog) = which("kdialog") {
        let mut command = Command::new(kdialog);
        command.args(["--title", title, "--error", text]);
        command
    } else {
        return;
    };
    let _ = command.status();
}

fn which(name: &str) -> Option<std::path::PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?).map(|dir| dir.join(name)).find(|path| path.is_file())
}

/// WebKitGTK's DMA-BUF renderer paints an empty window on the NVIDIA
/// proprietary driver. A user who set the variable either way keeps his choice.
pub(crate) fn before_webview() {
    if cfg!(target_os = "linux") && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/proc/driver/nvidia/version").exists() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// A system notification through the desktop's own tool: `notify-send` on
/// Linux, `osascript` on macOS. Neither tells the shell about a click, so the
/// thread does not open from it. The tool runs on its own, never through a
/// shell, and a thread reaps it: the command holds the main thread for no
/// longer than the start. A missing tool is an error, which the UI turns into
/// one "unavailable" message and the switch off.
pub(crate) fn notify(_app: AppHandle, title: String, body: String, _thread_id: String) -> Result<(), String> {
    let mut command = notify_command(cfg!(target_os = "macos"), &title, &body);
    let mut child = command.spawn().map_err(|error| format!("{:?} could not start: {error}", command.get_program()))?;
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}

/// Whether `notify` can show anything here: every Mac has `osascript`, a
/// Linux desktop needs libnotify's `notify-send` on the PATH.
pub(crate) fn notify_supported() -> bool {
    cfg!(target_os = "macos") || which("notify-send").is_some()
}

fn notify_command(macos: bool, title: &str, body: &str) -> Command {
    if macos {
        let mut command = Command::new("osascript");
        command.arg("-e").arg(format!("display notification {} with title {}", applescript_string(body), applescript_string(title)));
        command
    } else {
        let mut command = Command::new("notify-send");
        // `--` so a title that starts with a dash is not read as an option.
        command.args(["--app-name=Boite", "--", title, body]);
        command
    }
}

/// An AppleScript string literal: its backslashes and quotes escaped, line
/// breaks as spaces, so the text cannot end the literal and run as script.
fn applescript_string(value: &str) -> String {
    let flat: String = value.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    format!("\"{}\"", flat.replace('\\', "\\\\").replace('"', "\\\""))
}
