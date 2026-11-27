use std::path::Path;

fn refused(path: &Path) -> String {
    format!("path {}: expected an absolute path on this computer, not a network share or a device", path.display())
}

/// A path a chat link names on this computer: absolute and on a drive. A drive
/// the user mapped (a NAS as `N:`) counts, since its server is the one the user
/// connected; a share named by its server (`\\server\share`) or a device path
/// would let an agent's text make this computer reach a server of its choice.
pub(crate) fn require_client_path(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    return check_windows_path(path);
    #[cfg(not(windows))]
    {
        reject_network_spelling(path)?;
        if path.is_absolute() { Ok(()) } else { Err(refused(path)) }
    }
}

#[cfg(not(windows))]
fn reject_network_spelling(path: &Path) -> Result<(), String> {
    let text = path.as_os_str().to_string_lossy();
    let mut chars = text.chars();
    if matches!(chars.next(), Some('/' | '\\')) && matches!(chars.next(), Some('/' | '\\')) {
        return Err(refused(path));
    }
    Ok(())
}

#[cfg(windows)]
fn check_windows_path(path: &Path) -> Result<(), String> {
    use std::path::{Component, Prefix};
    match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(_) | Prefix::VerbatimDisk(_) if path.is_absolute() => Ok(()),
            _ => Err(refused(path)),
        },
        _ => Err(refused(path)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn accepts_drives_mapped_ones_included_and_refuses_shares_devices_and_relative_paths() {
        for path in [r"\\server\share\file", "//server/share/file", r"\/server\share\file", r"/\server\share\file",
            r"\\?\UNC\server\share\file", r"\\.\pipe\file", r"\\?\Volume{abc}\file", r"C:relative.txt", "notes.txt", r"\rooted.txt"] {
            assert!(require_client_path(Path::new(path)).is_err(), "{path}");
        }
        for path in [r"C:\local\file", r"\\?\C:\local\file", r"N:\dev\orbitkit\orbitkit-setup.exe"] {
            assert!(require_client_path(Path::new(path)).is_ok(), "{path}");
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn accepts_absolute_paths_and_refuses_shares_and_relative_paths() {
        for path in ["//server/share/file", r"\\server\share\file", "notes.txt", "docs/notes.txt", ""] {
            assert!(require_client_path(Path::new(path)).is_err(), "{path}");
        }
        assert!(require_client_path(Path::new("/home/user/notes.txt")).is_ok());
    }
}
