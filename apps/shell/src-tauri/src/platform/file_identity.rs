use std::fs::File;
use std::io;
use std::path::Path;

/// A queued opener may get a file the old holder unlinked before unlocking it.
pub(crate) fn still_at(file: &File, path: &Path) -> io::Result<bool> {
    let current = File::open(path)?;
    Ok(identity(file)? == identity(&current)?)
}
fn identity(file: &File) -> io::Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata()?;
    Ok((metadata.dev(), metadata.ino()))
}
