use std::path::{Path, PathBuf};
use tauri::Webview;

fn resolve_file(directory: &Path, path: &Path) -> Result<PathBuf, String> {
    if !directory.is_absolute() {
        return Err(format!("directory {}: expected an absolute directory", directory.display()));
    }
    let root = directory.canonicalize().map_err(|error| format!("directory {}: {error}", directory.display()))?;
    if !root.is_dir() {
        return Err(format!("directory {}: expected a directory", directory.display()));
    }
    let candidate = root.join(path);
    let file = candidate.canonicalize().map_err(|error| format!("path {}: {error}", path.display()))?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err(format!("path {}: expected a file inside {}", path.display(), directory.display()));
    }
    Ok(file)
}

/// Only a click in the main UI uses this command; browsed pages cannot call it.
#[tauri::command]
pub async fn open_local_file(webview: Webview, directory: String, path: String) -> Result<(), String> {
    crate::browser::only_main(&webview)?;
    let file = resolve_file(Path::new(&directory), Path::new(&path))?;
    crate::platform::open_file(&file)
}

/// What a chat link may open in its default app: documents, pictures, media and
/// data. Anything else (a program, a script, a shortcut, a `.desktop` entry, an
/// association that runs code such as `.js` or `.py` on Windows) is refused, so
/// the list says what is allowed rather than what is not.
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
fn runs(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).map(|meta| meta.permissions().mode() & 0o111 != 0).unwrap_or(true)
}

#[cfg(not(unix))]
fn runs(_path: &Path) -> bool {
    false
}

/// A link's target inside the thread's folder: a folder, or a document that does not run.
fn resolve_chat_path(directory: &Path, path: &str) -> Result<PathBuf, String> {
    crate::platform::require_local_path(directory)?;
    crate::platform::require_local_path(Path::new(path))?;
    if path.is_empty() || path.chars().any(char::is_control) || path.starts_with("\\\\") || path.starts_with("//") {
        return Err("path: expected a local file or folder, not a network or device path".into());
    }
    let root = directory.canonicalize().map_err(|error| format!("directory {}: {error}", directory.display()))?;
    if !directory.is_absolute() || !root.is_dir() {
        return Err("directory: expected an existing absolute thread directory".into());
    }
    let candidate = root.join(path);
    crate::platform::require_local_path(&candidate)?;
    let resolved = candidate.canonicalize().map_err(|error| format!("path {path}: {error}"))?;
    crate::platform::require_local_path(&resolved)?;
    if !resolved.starts_with(&root) {
        return Err(format!("path {path}: expected a file or folder inside {}", directory.display()));
    }
    let kind = extension(&resolved);
    if resolved.is_dir() {
        if BUNDLE_FOLDERS.contains(&kind.as_str()) {
            return Err(format!("path {path}: expected a folder, not an application bundle"));
        }
        return Ok(resolved);
    }
    if !resolved.is_file() {
        return Err(format!("path {path}: expected a file or folder"));
    }
    if !CHAT_DOCUMENTS.contains(&kind.as_str()) || runs(&resolved) {
        return Err(format!("path {path}: expected a document ({}) that is not executable", CHAT_DOCUMENTS.join(", ")));
    }
    Ok(resolved)
}

/// The opt-in chat-link action, invoked by a click in the main UI, never by an agent RPC or browsed page.
#[tauri::command]
pub async fn open_chat_file(webview: Webview, directory: String, path: String) -> Result<(), String> {
    crate::browser::only_main(&webview)?;
    let file = resolve_chat_path(Path::new(&directory), &path)?;
    crate::platform::open_file(&file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_links_open_only_folders_and_documents_inside_the_thread() {
        let root = std::env::temp_dir().join(format!("boite-chat-links-{}", std::process::id()));
        let project = root.join("project");
        std::fs::create_dir_all(project.join("docs")).unwrap();
        std::fs::create_dir_all(project.join("Tool.app")).unwrap();
        std::fs::write(root.join("outside.pdf"), b"inert fixture").unwrap();
        std::fs::write(project.join("notes.txt"), b"notes").unwrap();
        std::fs::write(project.join("Report.PDF"), b"inert fixture").unwrap();
        for name in ["test shortcut.lnk", "page.url", "run.hta", "run.vbs", "run.js", "run.ps1", "run.py", "run.bat", "game.exe", "settings.reg", "start.desktop", "tool.AppImage", "run.command", "Makefile"] {
            std::fs::write(project.join(name), b"inert fixture").unwrap();
        }
        assert!(resolve_chat_path(&project, "notes.txt").is_ok());
        assert!(resolve_chat_path(&project, "Report.PDF").is_ok());
        assert!(resolve_chat_path(&project, &project.join("notes.txt").to_string_lossy()).is_ok());
        assert!(resolve_chat_path(&project, "docs").unwrap().is_dir());
        for path in ["test shortcut.lnk", "page.url", "run.hta", "run.vbs", "run.js", "run.ps1", "run.py", "run.bat", "game.exe", "settings.reg", "start.desktop", "tool.AppImage", "run.command", "Makefile", "Tool.app"] {
            assert!(resolve_chat_path(&project, path).is_err(), "{path} must not open");
        }
        // Outside the thread's folder, by an absolute path or by climbing, nothing opens.
        assert!(resolve_chat_path(&project, &root.join("outside.pdf").to_string_lossy()).is_err());
        assert!(resolve_chat_path(&project, "../outside.pdf").is_err());
        assert!(resolve_chat_path(&project, &root.to_string_lossy()).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(project.join("notes.txt"), std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(resolve_chat_path(&project, "notes.txt").is_err());
        }
        for path in ["", "//server/share/file.txt", "\\\\server\\share\\file.txt", "\\/server/share/file.txt", "/\\server/share/file.txt", "bad\0file", "missing.txt"] {
            assert!(resolve_chat_path(&project, path).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_existing_files_and_rejects_paths_outside_the_thread() {
        let root = std::env::temp_dir().join(format!("boite-local-files-{}", std::process::id()));
        let inside = root.join("project");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::write(inside.join("game.exe"), b"inert fixture").unwrap();
        std::fs::write(root.join("outside.exe"), b"inert fixture").unwrap();
        assert_eq!(resolve_file(&inside, Path::new("game.exe")).unwrap(), inside.join("game.exe").canonicalize().unwrap());
        assert!(resolve_file(&inside, &inside.join("game.exe")).is_ok());
        assert!(resolve_file(&inside, Path::new("../outside.exe")).is_err());
        assert!(resolve_file(&inside, &root.join("outside.exe")).is_err());
        assert!(resolve_file(&inside, Path::new("missing.exe")).is_err());
        assert!(resolve_file(&inside, Path::new(".")).is_err());
        assert!(resolve_file(Path::new("relative"), Path::new("game.exe")).is_err());
        let error = resolve_file(&inside.join("game.exe"), &inside.join("game.exe")).unwrap_err();
        assert!(error.starts_with("directory ") && error.contains("expected a directory"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
