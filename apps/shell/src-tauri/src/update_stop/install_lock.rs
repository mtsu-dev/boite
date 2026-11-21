//! The data directory's `core.lock` as the shell holds it while an update installs. A core older
//! than the OS lock reads only the record: an empty one, or one naming a process that is gone,
//! it unlinks and starts on a new file. So the shell writes itself there as a live owner, as a
//! core does, and takes the record away again when it lets go.
use std::fs::File;
use std::io::{self, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::platform::file_identity::still_at;

/// A held `core.lock` with this shell's record in it. Dropping it, on an install, a cancellation,
/// a failure or a restart, removes the record only while the path still names the locked file.
pub(crate) struct InstallLock { file: File, path: PathBuf }

impl InstallLock {
    /// Writes `pid` and its start through the held handle, never by path: an older core may have
    /// replaced the file since it was judged, and a write by path would land in its file. `None`
    /// when the path names another file afterwards: that core is in and keeps its record.
    /// One that judged the old record and replaces the file after this check still gets in, as
    /// two older cores could race each other (`takeLock` in the core).
    pub(crate) fn publish(file: File, path: PathBuf, pid: u32, start_key: Option<String>) -> io::Result<Option<Self>> {
        let started_at = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX));
        let mut record = serde_json::json!({ "pid": pid, "startedAt": started_at, "osLock": true });
        if let Some(key) = start_key { record["startKey"] = key.into(); }
        // Owned from here, so a failed write is cleared too.
        let mut lock = Self { file, path };
        lock.file.set_len(0)?;
        lock.file.seek(SeekFrom::Start(0))?;
        lock.file.write_all(format!("{record:#}\n").as_bytes())?;
        lock.file.sync_data()?;
        Ok(lock.ours().then_some(lock))
    }

    fn ours(&self) -> bool {
        still_at(&self.file, &self.path).unwrap_or(false)
    }
}

impl Drop for InstallLock {
    fn drop(&mut self) {
        // Removed while still held, so the next holder cannot lock the file the path no longer names unnoticed.
        if self.ours() { let _ = std::fs::remove_file(&self.path); }
    }
}
