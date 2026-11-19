use std::fs::File;
use std::io;
use std::path::Path;

/// A queued opener may get a file the old holder unlinked before unlocking it.
pub(crate) fn still_at(file: &File, path: &Path) -> io::Result<bool> {
    let current = File::open(path)?;
    Ok(identity(file)? == identity(&current)?)
}

#[cfg(unix)]
fn identity(file: &File) -> io::Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata()?;
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn identity(file: &File) -> io::Result<(u32, u64)> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let index = u64::from(info.nFileIndexHigh) << 32 | u64::from(info.nFileIndexLow);
    Ok((info.dwVolumeSerialNumber, index))
}
