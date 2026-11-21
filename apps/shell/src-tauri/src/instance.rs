use std::fs::{create_dir_all, File, OpenOptions, TryLockError};
use std::hash::{BuildHasher, Hasher};
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

const INSTANCE_WAIT: Duration = Duration::from_secs(5);

/// A relaunch waits for the previous process to exit. A manual launch can
/// hand its Show request to that process once it is accepting requests.
pub(crate) fn acquire_or_wake(directory: &Path, restarting: bool, show: bool) -> io::Result<Option<File>> {
    let deadline = Instant::now() + INSTANCE_WAIT;
    loop {
        let acquired = acquire(directory)?;
        if acquired.is_some() || (!restarting && !show) { return Ok(acquired); }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { return Ok(None); }
        if !restarting && wake(directory, remaining).is_ok() { return Ok(None); }
        std::thread::sleep(remaining.min(Duration::from_millis(100)));
    }
}

/// The OS releases the lock even after a hard kill. Each data directory owns
/// one shell, so tests and the two installed channels remain independent.
pub fn acquire(directory: &Path) -> io::Result<Option<File>> {
    create_dir_all(directory)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("shell.lock"))?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(error)) => Err(error),
    }
}

/// Where the shell that owns a data directory listens for a second launch:
/// `<port> <token>`, next to `shell.lock`, so it is keyed on the data
/// directory like the lock and a test shell never reaches the user's window.
const WAKE_FILE: &str = "shell-wake";
const WAKE_TIMEOUT: Duration = Duration::from_secs(1);

/// A token no other program can guess: the process's random hash keys, mixed
/// with its pid and the time. Only a reader of the data directory learns it.
fn token() -> String {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let first = hasher.finish();
    let mut second = std::collections::hash_map::RandomState::new().build_hasher();
    second.write_u64(first);
    format!("{first:016x}{:016x}", second.finish())
}

/// Called by the owner once it holds the lock: every connection that sends
/// this directory's token runs `on_wake`, which brings the window back.
pub fn listen(directory: &Path, on_wake: impl Fn() -> bool + Send + 'static) -> io::Result<()> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    let token = token();
    let temporary = directory.join(format!("{WAKE_FILE}.tmp"));
    std::fs::write(&temporary, format!("{port} {token}"))?;
    std::fs::rename(&temporary, directory.join(WAKE_FILE))?;
    let request = format!("show {token}");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let _ = stream.set_read_timeout(Some(WAKE_TIMEOUT));
            let mut received = Vec::new();
            let _ = (&mut stream).take(128).read_to_end(&mut received);
            if received == request.as_bytes() && on_wake() {
                let _ = stream.set_write_timeout(Some(WAKE_TIMEOUT));
                let _ = stream.write_all(b"ok");
            }
        }
    });
    Ok(())
}

/// Called by a second launch: asks the shell that owns `directory` to show
/// its window. An error says why nothing came back to the screen.
fn wake(directory: &Path, budget: Duration) -> io::Result<()> {
    let text = std::fs::read_to_string(directory.join(WAKE_FILE))?;
    let (port, token) = text
        .trim()
        .split_once(' ')
        .and_then(|(port, token)| Some((port.parse::<u16>().ok()?, token)))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, format!("{WAKE_FILE} must hold `<port> <token>`")))?;
    let deadline = Instant::now() + budget.min(WAKE_TIMEOUT);
    let timeout = || deadline.checked_duration_since(Instant::now()).filter(|time| !time.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "the running shell did not acknowledge Show"));
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), timeout()?)?;
    stream.set_write_timeout(Some(timeout()?))?;
    stream.write_all(format!("show {token}").as_bytes())?;
    stream.shutdown(Shutdown::Write)?;
    stream.set_read_timeout(Some(timeout()?))?;
    let mut reply = [0; 2];
    stream.read_exact(&mut reply)?;
    if &reply == b"ok" { return Ok(()); }
    Err(io::Error::new(io::ErrorKind::InvalidData, "the running shell did not acknowledge Show"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn one_owner_per_directory_until_the_handle_closes() {
        let _process_guard = crate::process_test_guard();
        let root = std::env::temp_dir().join(format!("boite-instance-{}", std::process::id()));
        let first = acquire(&root).unwrap().unwrap();
        assert!(acquire(&root).unwrap().is_none());
        let other = acquire(&root.join("other-channel")).unwrap().unwrap();
        drop(first);
        let replacement = acquire(&root).unwrap().unwrap();
        drop(replacement);
        drop(other);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_second_launch_wakes_the_owner_and_a_wrong_token_does_not() {
        let root = std::env::temp_dir().join(format!("boite-wake-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let _owner = acquire(&root).unwrap().unwrap();
        // Nobody listens yet: the second launch says so instead of exiting quietly.
        assert!(wake(&root, WAKE_TIMEOUT).is_err());
        let woken = Arc::new(AtomicUsize::new(0));
        let count = woken.clone();
        let directory = root.clone();
        let second = std::thread::spawn(move || acquire_or_wake(&directory, false, true).unwrap());
        listen(&root, move || { count.fetch_add(1, Ordering::SeqCst); true }).unwrap();
        assert!(acquire(&root).unwrap().is_none(), "the second launch must still lose the lock");
        assert!(second.join().unwrap().is_none());
        assert_eq!(woken.load(Ordering::SeqCst), 1);
        // A local program that read only the port cannot raise the window.
        let port: u16 = std::fs::read_to_string(root.join(WAKE_FILE)).unwrap().split(' ').next().unwrap().parse().unwrap();
        let mut stranger = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        stranger.write_all(b"show nope").unwrap();
        drop(stranger);
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(woken.load(Ordering::SeqCst), 1);
        drop(_owner);
        std::fs::remove_dir_all(root).unwrap();
    }
}
