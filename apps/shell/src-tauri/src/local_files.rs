use std::path::{Path, PathBuf};
use tauri::Webview;

/// What a chat link names on this computer, which decides what a click may do
/// with it: a document or a folder opens at once, anything else only once the
/// user confirmed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientPathKind {
    Missing,
    Document,
    Folder,
    Program,
}

/// What a chat link may open in its default app without asking: documents,
/// pictures, media and data. Anything else (a program, a script, a shortcut, a
/// `.desktop` entry, an association that runs code such as `.js` or `.py` on
/// Windows) is a program, so the list says what is allowed rather than what is not.
const CHAT_DOCUMENTS: &[&str] = &[
    "txt", "md", "markdown", "log", "csv", "tsv", "json", "yaml", "yml", "toml", "xml", "html", "htm",
    "pdf", "rtf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub",
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tif", "tiff", "heic", "avif",
    "mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "mp4", "mov", "webm", "mkv", "avi", "m4v",
];
/// Folders that are programs on macOS; any other folder opens in the file manager.
const BUNDLE_FOLDERS: &[&str] = &["app", "workflow", "action", "bundle", "framework", "prefpane", "appex", "xpc", "plugin", "kext"];

fn extension(path: &Path) -> String {
    path.extension().map(|value| value.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

#[cfg(unix)]
fn runs(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn runs(_meta: &std::fs::Metadata) -> bool {
    false
}

/// The path a link names, as long as it is an absolute one on this computer
/// (`require_client_path`): a relative one would resolve against wherever the
/// shell runs from, which no link means.
fn client_target(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.chars().any(char::is_control) {
        return Err(format!("path {path:?}: expected an absolute path on this computer"));
    }
    let target = PathBuf::from(path);
    crate::platform::require_client_path(&target)?;
    Ok(target)
}

/// Read through links, like the app the click opens. A link is a document only
/// when both its own name and the file it leads to are one: `notes.txt` linked
/// to a program is a program. A drive that does not answer (an unplugged NAS)
/// reads as missing.
fn classify(path: &Path) -> ClientPathKind {
    let Ok(resolved) = path.canonicalize() else { return ClientPathKind::Missing };
    let Ok(meta) = std::fs::metadata(&resolved) else { return ClientPathKind::Missing };
    let kinds = [extension(path), extension(&resolved)];
    if meta.is_dir() {
        let bundle = kinds.iter().any(|kind| BUNDLE_FOLDERS.contains(&kind.as_str()));
        return if bundle { ClientPathKind::Program } else { ClientPathKind::Folder };
    }
    if meta.is_file() && kinds.iter().all(|kind| CHAT_DOCUMENTS.contains(&kind.as_str())) && !runs(&meta) {
        return ClientPathKind::Document;
    }
    ClientPathKind::Program
}

/// The click's action once the path is known: a program needs the confirmation the UI asked for.
fn open_target(path: &str, confirmed: bool) -> Result<PathBuf, String> {
    let target = client_target(path)?;
    match classify(&target) {
        ClientPathKind::Missing => Err(format!("path {path}: not found on this computer")),
        ClientPathKind::Program if !confirmed => Err(format!("path {path}: a program or a file that may run one opens only once the user confirmed it")),
        _ => Ok(target),
    }
}

fn reveal_target(path: &str) -> Result<PathBuf, String> {
    let target = client_target(path)?;
    if classify(&target) == ClientPathKind::Missing {
        return Err(format!("path {path}: not found on this computer"));
    }
    Ok(target)
}

/// A network drive can take seconds to answer: the check runs off the command thread.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| format!("the file check did not finish: {error}"))?
}

/// What a chat link names on this computer. Only the main UI asks, to choose
/// what its click does and to grey a link that leads nowhere.
#[tauri::command]
pub async fn client_path_info(webview: Webview, path: String) -> Result<ClientPathKind, String> {
    crate::browser::only_main(&webview)?;
    blocking(move || client_target(&path).map(|target| classify(&target))).await
}

/// A click on a chat link in the main UI, never an agent RPC or a browsed page.
/// A program opens only with `confirmed`, which the UI sets once the user said yes.
#[tauri::command]
pub async fn open_client_path(webview: Webview, path: String, confirmed: bool) -> Result<(), String> {
    crate::browser::only_main(&webview)?;
    let target = blocking(move || open_target(&path, confirmed)).await?;
    crate::platform::open_file(&target)
}

/// Shows the file selected in its folder, in the system's file manager; nothing runs.
#[tauri::command]
pub async fn reveal_client_path(webview: Webview, path: String) -> Result<(), String> {
    crate::browser::only_main(&webview)?;
    let target = blocking(move || reveal_target(&path)).await?;
    tauri_plugin_opener::reveal_item_in_dir(&target).map_err(|error| format!("path {}: {error}", target.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documents_and_folders_open_at_once_and_everything_else_waits_for_a_confirmation() {
        let root = std::env::temp_dir().join(format!("boite-client-paths-{}", std::process::id()));
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::create_dir_all(root.join("Tool.app")).unwrap();
        std::fs::write(root.join("notes.txt"), b"notes").unwrap();
        std::fs::write(root.join("Report.PDF"), b"inert fixture").unwrap();
        let path = |name: &str| root.join(name).to_string_lossy().into_owned();
        let kind = |name: &str| classify(&client_target(&path(name)).unwrap());
        assert_eq!(kind("notes.txt"), ClientPathKind::Document);
        assert_eq!(kind("Report.PDF"), ClientPathKind::Document);
        assert_eq!(kind("docs"), ClientPathKind::Folder);
        assert_eq!(kind("missing.txt"), ClientPathKind::Missing);
        assert_eq!(kind("Tool.app"), ClientPathKind::Program);
        for name in ["test shortcut.lnk", "page.url", "run.hta", "run.vbs", "run.js", "run.ps1", "run.py", "run.bat", "game.exe", "setup.msi", "settings.reg", "start.desktop", "tool.AppImage", "run.command", "Makefile"] {
            std::fs::write(root.join(name), b"inert fixture").unwrap();
            assert_eq!(kind(name), ClientPathKind::Program, "{name}");
            let refused = open_target(&path(name), false).unwrap_err();
            assert!(refused.contains("confirmed"), "{name}: {refused}");
            assert!(open_target(&path(name), true).is_ok(), "{name}");
        }
        assert!(open_target(&path("notes.txt"), false).is_ok());
        assert!(open_target(&path("docs"), false).is_ok());
        assert!(open_target(&path("missing.txt"), true).unwrap_err().contains("not found"));
        assert!(reveal_target(&path("game.exe")).is_ok());
        assert!(reveal_target(&path("missing.txt")).unwrap_err().contains("not found"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root.join("notes.txt"), std::fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(kind("notes.txt"), ClientPathKind::Program);
            // A document's name on a link to a program, or to a bundle, is the program.
            std::os::unix::fs::symlink(root.join("game.exe"), root.join("readme.txt")).unwrap();
            std::os::unix::fs::symlink(root.join("Tool.app"), root.join("Tool")).unwrap();
            assert_eq!(kind("readme.txt"), ClientPathKind::Program);
            assert!(open_target(&path("readme.txt"), false).unwrap_err().contains("confirmed"));
            assert_eq!(kind("Tool"), ClientPathKind::Program);
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_relative_network_device_and_control_paths() {
        for path in ["", "notes.txt", "docs/notes.txt", "//server/share/file.txt", "\\\\server\\share\\file.txt", "bad\0file", "/tmp/bad\nname"] {
            assert!(client_target(path).is_err(), "{path:?}");
            assert!(open_target(path, true).is_err(), "{path:?}");
            assert!(reveal_target(path).is_err(), "{path:?}");
        }
    }
}
