use std::ffi::{OsStr, OsString};
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_HIDE};

/// The installed product publishes an NSIS executable as its Windows payload.
/// Keep the exact staged image pinned until NSIS starts, including across idle
/// admission refusals. Open without write or delete sharing.
pub(crate) struct PreparedNsis {
    path: PathBuf,
    _pin: File,
}

impl PreparedNsis {
    pub(crate) fn prepare(path: PathBuf, bytes: &[u8]) -> io::Result<Self> {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let mut writer = OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(0)
            .open(&path)?;
        writer.write_all(bytes)?;
        writer.sync_all()?;
        drop(writer);

        // Pin and compare after reopening: the file we checked must be the
        // file we launch even if another process races the two opens.
        let mut pin = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&path)?;
        let mut buffer = [0; 64 * 1024];
        if pin.metadata()?.len() != bytes.len() as u64 {
            return Err(io::Error::other("the prepared installer size changed"));
        }
        for chunk in bytes.chunks(buffer.len()) {
            pin.read_exact(&mut buffer[..chunk.len()])?;
            if buffer[..chunk.len()] != *chunk {
                return Err(io::Error::other(
                    "the prepared installer did not match the verified bytes",
                ));
            }
        }
        Ok(Self { path, _pin: pin })
    }

    pub(crate) fn launch(&self, args: impl Iterator<Item = OsString>) -> Result<(), String> {
        let args = nsis_arguments(args);
        let wide = |value: &OsStr| value.encode_wide().chain([0]).collect::<Vec<_>>();
        let file = wide(self.path.as_os_str());
        let args = wide(&args);
        // SAFETY: the command's two UTF-16 strings are NUL-terminated and
        // outlive the call. The pin excludes modification until launch.
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                windows_sys::w!("open"),
                file.as_ptr(),
                args.as_ptr(),
                std::ptr::null(),
                SW_HIDE,
            )
        } as isize;
        if result <= 32 {
            return Err(format!(
                "cannot launch prepared installer {} (Windows shell error {result})",
                self.path.display()
            ));
        }
        Ok(())
    }
}

pub(crate) fn discard(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Match Tauri's NSIS argument escaping. GetOptions strips a surrounding
/// pair of quotes from its result, so ordinary flags must stay bare.
fn nsis_arguments(args: impl Iterator<Item = OsString>) -> OsString {
    let mut line: Vec<u16> = "/S /UPDATE /R /ARGS".encode_utf16().collect();
    for arg in args {
        let quote = arg.is_empty()
            || arg
                .as_encoded_bytes()
                .iter()
                .any(|c| matches!(c, b' ' | b'\t' | b'/'));
        line.push(b' ' as u16);
        if quote {
            line.push(b'"' as u16);
        }
        let mut backslashes = 0;
        for unit in arg.encode_wide() {
            if unit == b'"' as u16 {
                line.extend(std::iter::repeat_n(b'\\' as u16, backslashes + 1));
            }
            backslashes = if unit == b'\\' as u16 {
                backslashes + 1
            } else {
                0
            };
            line.push(unit);
        }
        if quote {
            line.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
            line.push(b'"' as u16);
        }
    }
    OsString::from_wide(&line)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prepared_installer_cannot_be_replaced_until_the_handoff_releases_it() {
        let directory =
            std::env::temp_dir().join(format!("boite-nsis-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("installer.exe");
        let source = vec![42; 132_000];
        let ready = PreparedNsis::prepare(path.clone(), &source).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), source);
        assert!(File::create(&path).is_err());
        assert!(std::fs::rename(&path, directory.join("other.exe")).is_err());
        drop(ready);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn nsis_forwards_slashes_and_trailing_backslashes_in_shell_arguments() {
        let args = [
            "--autostart",
            "/example",
            r"C:\test directory\",
            "two\"quotes",
        ]
        .map(OsString::from);
        assert_eq!(
            nsis_arguments(args.into_iter()),
            r#"/S /UPDATE /R /ARGS --autostart "/example" "C:\test directory\\" two\"quotes"#
        );
    }
}
