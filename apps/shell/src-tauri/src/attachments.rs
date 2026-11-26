//! A file an agent attached to its answer, saved where the user keeps his
//! downloads. WebView2 gives an `<a download>` no feedback in a frameless
//! window, so the UI hands the bytes here and gets back a path it can show.
//!
//! Opening runs the system's default application, so only inert documents and
//! media are opened; anything else is shown selected in its folder instead. An
//! agent, local or remote, can therefore not run a program through a click.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{Manager, Webview};

/// `ATTACHMENT_MAX_BYTES` in `packages/contracts/src/attachment-limits.ts`.
const MAX_BYTES: usize = 5 * 1024 * 1024;
/// Markdown and HTML exports are built in memory by the main webview and can
/// span many turns. Bound that IPC payload separately from chat attachments.
/// Keep in sync with `DESKTOP_EXPORT_MAX_MIB` in `thread-export.ts`.
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
const FALLBACK_NAME: &str = "attachment";
const MAX_NAME_CHARS: usize = 150;
const COMPARE_CHUNK_BYTES: usize = 64 * 1024;

fn check_save_size(name: &str, open: bool, export: bool, bytes: usize) -> Result<(), String> {
    let is_export = export && !open && Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("html"));
    let limit = if is_export { MAX_EXPORT_BYTES } else { MAX_BYTES };
    if bytes > limit {
        return Err(format!("body: expected at most {limit} bytes, got {bytes}"));
    }
    Ok(())
}

/// Extensions whose default application only displays or plays the file.
const OPENABLE: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "tif", "tiff", "heic", "ico",
    "pdf", "txt", "md", "log", "csv", "tsv", "json",
    "mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus",
    "mp4", "m4v", "webm", "mov", "mkv", "avi",
    "docx", "xlsx", "pptx", "odt", "ods", "odp", "rtf", "zip",
];

const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A file name every desktop system accepts, with no directory in it.
pub(crate) fn safe_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .map(|c| if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).trim_start_matches('.');
    if trimmed.is_empty() {
        return FALLBACK_NAME.into();
    }
    let (stem, extension) = split(trimmed);
    let stem: String = stem.chars().take(MAX_NAME_CHARS).collect();
    let stem = if RESERVED.contains(&stem.to_ascii_lowercase().as_str()) { format!("_{stem}") } else { stem };
    match extension {
        Some(extension) => format!("{stem}.{}", extension.chars().take(16).collect::<String>()),
        None => stem,
    }
}

fn split(name: &str) -> (&str, Option<&str>) {
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => (stem, Some(extension)),
        _ => (name, None),
    }
}

pub(crate) fn openable(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| OPENABLE.contains(&extension.to_ascii_lowercase().as_str()))
}

fn same_bytes(path: &Path, expected: &[u8]) -> bool {
    let Ok(mut file) = File::open(path) else { return false; };
    let Ok(meta) = file.metadata() else { return false; };
    if !meta.is_file() || meta.len() != expected.len() as u64 {
        return false;
    }
    let mut buffer = [0u8; COMPARE_CHUNK_BYTES];
    let mut offset = 0;
    loop {
        let Ok(read) = file.read(&mut buffer) else { return false; };
        if read == 0 {
            return offset == expected.len();
        }
        if expected.get(offset..offset + read) != Some(&buffer[..read]) {
            return false;
        }
        offset += read;
    }
}

/// Writes `bytes` in `directory` under `name`, or `name (2)` and so on when
/// another file holds it. A file there with the same name and the same bytes
/// is the one a previous click saved, and is reused rather than copied again.
pub(crate) fn save_into(directory: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let name = safe_name(name);
    let (stem, extension) = split(&name);
    fs::create_dir_all(directory).map_err(|error| format!("directory {}: {error}", directory.display()))?;
    for attempt in 1..=999 {
        let candidate = directory.join(match (attempt, extension) {
            (1, _) => name.clone(),
            (n, Some(extension)) => format!("{stem} ({n}).{extension}"),
            (n, None) => format!("{stem} ({n})"),
        });
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(mut file) => {
                let written = file.write_all(bytes).and_then(|()| file.sync_all());
                if let Err(error) = written {
                    drop(file);
                    let _ = fs::remove_file(&candidate);
                    return Err(format!("path {}: {error}", candidate.display()));
                }
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if same_bytes(&candidate, bytes) {
                    return Ok(candidate);
                }
            }
            Err(error) => return Err(format!("path {}: {error}", candidate.display())),
        }
    }
    Err(format!("directory {}: no free name for {name}", directory.display()))
}

#[derive(serde::Serialize)]
pub struct Saved {
    path: String,
    /// True when the file was opened, false when it was only shown in its folder or not asked to open.
    opened: bool,
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|value| value.to_str().ok())
}

/// Body: the raw bytes. Headers: `x-boite-name`, percent-encoded, and
/// `x-boite-open`, `1` to open the saved file (or show it when its type is not
/// inert), anything else to only save it. `x-boite-export: 1` allows a larger
/// body for Markdown and HTML downloads.
#[tauri::command]
pub async fn save_attachment(webview: Webview, request: Request<'_>) -> Result<Saved, String> {
    crate::browser::only_main(&webview)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("body: expected the attachment's raw bytes".into());
    };
    let name = header(&request, "x-boite-name").ok_or("x-boite-name: expected the file name")?;
    let name = decode(name).ok_or("x-boite-name: expected a percent-encoded UTF-8 name")?;
    let safe = safe_name(&name);
    let open = header(&request, "x-boite-open") == Some("1");
    let export = header(&request, "x-boite-export") == Some("1");
    check_save_size(&safe, open, export, bytes.len())?;
    let directory = webview
        .app_handle()
        .path()
        .download_dir()
        .map_err(|error| format!("downloads folder: {error}"))?;
    let bytes = bytes.to_vec();
    tauri::async_runtime::spawn_blocking(move || {
        let path = save_into(&directory, &safe, &bytes)?;
        finish_save(path, open)
    })
    .await
    .map_err(|error| format!("save task: {error}"))?
}

pub(crate) fn finish_save(path: PathBuf, open: bool) -> Result<Saved, String> {
    let mut opened = false;
    if open {
        if openable(&path) {
            crate::platform::open_file(&path)?;
            opened = true;
        } else {
            tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|error| format!("path {}: {error}", path.display()))?;
        }
    }
    Ok(Saved { path: path.display().to_string(), opened })
}

/// `encodeURIComponent` undone.
fn decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = std::str::from_utf8(bytes.get(at + 1..at + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_lose_directories_reserved_words_and_forbidden_characters() {
        assert_eq!(safe_name("photo.png"), "photo.png");
        assert_eq!(safe_name("../../evil/run.exe"), "run.exe");
        assert_eq!(safe_name("C:\\Windows\\a:b?.txt"), "a_b_.txt");
        assert_eq!(safe_name("CON.txt"), "_CON.txt");
        assert_eq!(safe_name("..."), FALLBACK_NAME);
        assert_eq!(safe_name(".bashrc"), "bashrc");
        assert_eq!(safe_name("report.pdf. "), "report.pdf");
        assert_eq!(safe_name(""), FALLBACK_NAME);
    }

    #[test]
    fn only_inert_types_open() {
        assert!(openable(Path::new("a/photo.JPG")));
        assert!(openable(Path::new("handoff.pdf")));
        for name in ["setup.exe", "run.bat", "x.ps1", "page.html", "image.svg", "link.lnk", "noextension"] {
            assert!(!openable(Path::new(name)), "{name} must not open");
        }
    }

    #[test]
    fn downloads_accept_an_export_larger_than_an_attachment() {
        for name in ["conversation.md", "conversation.html", "conversation.md. "] {
            let safe = safe_name(name);
            assert!(check_save_size(&safe, false, true, MAX_BYTES + 1).is_ok());
            assert!(check_save_size(&safe, false, true, MAX_EXPORT_BYTES).is_ok());
            assert!(check_save_size(&safe, false, true, MAX_EXPORT_BYTES + 1).is_err());
            assert!(check_save_size(&safe, true, true, MAX_BYTES + 1).is_err());
            assert!(check_save_size(&safe, false, false, MAX_BYTES + 1).is_err());
        }
        assert!(check_save_size(&safe_name("attachment.zip"), false, true, MAX_BYTES + 1).is_err());
        assert!(check_save_size(&safe_name("..."), false, true, MAX_BYTES + 1).is_err());
    }

    #[test]
    fn saving_twice_reuses_the_same_bytes_and_numbers_different_ones() {
        let root = std::env::temp_dir().join(format!("boite-attachments-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let first = save_into(&root, "shot.png", b"one").unwrap();
        assert_eq!(first, root.join("shot.png"));
        assert_eq!(save_into(&root, "shot.png", b"one").unwrap(), first);
        assert_eq!(save_into(&root, "shot.png", b"two").unwrap(), root.join("shot (2).png"));
        assert_eq!(save_into(&root, "shot.png", b"two").unwrap(), root.join("shot (2).png"));
        assert_eq!(save_into(&root, "README", b"x").unwrap(), root.join("README"));
        assert_eq!(save_into(&root, "README", b"y").unwrap(), root.join("README (2)"));
        // Multi-chunk streaming comparison matches identical large exports and numbers changed tails.
        let mut big = vec![b'a'; COMPARE_CHUNK_BYTES * 2 + 17];
        let big_first = save_into(&root, "export.md", &big).unwrap();
        assert_eq!(save_into(&root, "export.md", &big).unwrap(), big_first);
        *big.last_mut().unwrap() = b'b';
        assert_eq!(save_into(&root, "export.md", &big).unwrap(), root.join("export (2).md"));
        assert_eq!(fs::read(root.join("shot (2).png")).unwrap(), b"two");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn percent_decoding_matches_encode_uri_component() {
        assert_eq!(decode("capture%20d%E2%80%99%C3%A9cran.png").as_deref(), Some("capture d\u{2019}\u{e9}cran.png"));
        assert_eq!(decode("bad%zz"), None);
        assert_eq!(decode("cut%E2"), None);
    }
}
