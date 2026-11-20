//! An update hands the running turns to the next core: each one ends the tool call it is in,
//! 30 seconds at most, stops, and resumes after the restart. A core too old for that handoff
//! keeps the earlier rule: it stays usable until it grants an idle stop.
use std::io::{Read, Write};
#[cfg(unix)]
use std::fs::{OpenOptions, TryLockError};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

#[cfg(unix)]
use serde::Deserialize;

use crate::local_core::health::{health, read_core_file, same_core, HEALTH_TIMEOUT};
#[cfg(unix)]
use {crate::local_core::{health::CoreStart, starting::read_starting}, crate::platform::file_identity};
use crate::platform::process::Watched;

#[cfg(unix)]
mod install_lock;
#[cfg(unix)]
pub(crate) use install_lock::InstallLock;
#[cfg(all(test, unix))]
pub(crate) mod legacy_core;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum InstallState {
    Idle,
    Waiting,
    Cancelled,
    Committed,
    CancelledForRecovery,
    CommittedWithRecovery,
    Restarting,
}

impl InstallState {
    pub(crate) fn start(&mut self) -> bool {
        if *self != Self::Idle { return false; }
        *self = Self::Waiting;
        true
    }

    pub(crate) fn cancel(&mut self) -> bool {
        if *self != Self::Waiting { return false; }
        *self = Self::Cancelled;
        true
    }

    pub(crate) fn cancelled(self) -> bool {
        matches!(self, Self::Cancelled | Self::CancelledForRecovery)
    }

    /// The dead browser cannot cancel its own request. An accepted handoff
    /// must finish first, since a successful install already restarts the shell.
    #[cfg_attr(not(any(windows, test)), allow(dead_code))]
    pub(crate) fn webview_failed(&mut self) -> bool {
        *self = match *self {
            Self::Idle => Self::Restarting,
            Self::Waiting | Self::Cancelled => Self::CancelledForRecovery,
            Self::Committed => Self::CommittedWithRecovery,
            _ => return false,
        };
        *self == Self::Restarting
    }

    /// Called once the install returned or was cancelled and the core hold is released.
    pub(crate) fn finish(&mut self) -> bool {
        if *self == Self::Restarting { return false; }
        let restart = matches!(self, Self::CancelledForRecovery | Self::CommittedWithRecovery);
        *self = if restart { Self::Restarting } else { Self::Idle };
        restart
    }
}

/// A policy update can arrive while an accepted core handoff drains its turns.
pub(crate) fn launch_if_allowed(check: impl FnOnce() -> Result<(), String>, launch: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    check()?;
    launch()
}

/// The core's grace for a tool call (30 s), its deadline for a turn that ignores its stop (12 s)
/// and its own shutdown, with a margin.
pub(crate) const HANDOFF_EXIT: Duration = Duration::from_secs(60);

#[cfg(unix)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockRecord {
    pid: u32,
    started_at: Option<u64>,
    start_key: Option<String>,
    #[serde(default)]
    os_lock: bool,
}

#[cfg(unix)]
fn core_is_running(directory: &Path) -> Result<bool, String> {
    let core = read_core_file(&directory.join("core.json"))?;
    Ok(core.is_some_and(|core| core.pid.is_some_and(|pid| same_core(pid, &core.start())))
        || read_starting(directory).is_some())
}

/// Holds the same lock startup takes. A legacy PID record can still exclude
/// us even without an OS lock. A live core must use authenticated admission.
/// The shell then publishes itself as the live owner, which keeps out a core
/// older than the OS lock as well (`InstallLock`).
#[cfg(unix)]
pub(crate) fn lock_without_core(directory: &Path) -> Result<Option<InstallLock>, String> {
    if core_is_running(directory)? { return Ok(None); }
    let path = directory.join("core.lock");
    let failed = |error: std::io::Error| format!("cannot lock {} for the update: {error}", path.display());
    let mut lock = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&path).map_err(failed)?;
    match lock.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return Ok(None),
        Err(TryLockError::Error(error)) => return Err(failed(error)),
    }
    if !file_identity::still_at(&lock, &path).map_err(failed)? || core_is_running(directory)? {
        return Ok(None);
    }
    let mut record = Vec::new();
    (&mut lock).take(4096).read_to_end(&mut record).map_err(failed)?;
    if serde_json::from_slice::<LockRecord>(&record).ok().is_some_and(|owner|
        !owner.os_lock && same_core(owner.pid, &CoreStart { at: owner.started_at, key: owner.start_key }))
    {
        return Ok(None);
    }
    let pid = std::process::id();
    InstallLock::publish(lock, path.clone(), pid, crate::platform::process::start_key(pid)).map_err(failed)
}

enum Admission { Accepted, Busy, Unsupported }

/// Only the exact process that was probed may accept the stop. Older cores fail closed.
fn request_shutdown(path: &str, port: u16, token: &str, pid: u32) -> Result<Admission, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, HEALTH_TIMEOUT).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(3))).map_err(|e| e.to_string())?;
    write!(stream, "POST {path}?pid={pid} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").map_err(|e| e.to_string())?;
    let mut response = String::new();
    stream.take(16 * 1024).read_to_string(&mut response).map_err(|e| e.to_string())?;
    let code = response.split_whitespace().nth(1).unwrap_or("missing");
    if code == "409" { return Ok(Admission::Busy); }
    if code == "404" { return Ok(Admission::Unsupported); }
    if code != "202" { return Err(format!("the engine refused safe update admission (HTTP {code}); stop it explicitly before installing")); }
    let body = response.split_once("\r\n\r\n").map(|(_, body)| body).unwrap_or("");
    let value: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("invalid update admission: {e}"))?;
    if value.get("ok").and_then(|v| v.as_bool()) != Some(true) || value.get("pid").and_then(|v| v.as_u64()) != Some(pid as u64) {
        return Err("update admission must acknowledge the probed core pid".into());
    }
    Ok(Admission::Accepted)
}

/// Cancellation and each admission request share the mutex. Once committed, cancellation is too late.
/// A core with the handoff commits on the first request, busy or not; an older one is polled until idle.
/// `idle_only`, for an install nobody asked for now, skips the handoff and asks for the idle stop
/// once: a busy core keeps running and the answer is false. `still` checks
/// visibility and policy again immediately before every stop request.
pub(crate) fn stop_for_update(directory: &Path, control: &Mutex<InstallState>, idle_only: bool, still: impl Fn() -> Result<bool, String>, committed: impl Fn()) -> Result<bool, String> {
    let core = read_core_file(&directory.join("core.json"))?.ok_or("core.json is missing; nothing was installed")?;
    let pid = core.pid.ok_or("core.json must identify the core pid; nothing was installed")?;
    let process = Watched::open(pid).ok_or("the expected core process could not be watched; nothing was installed")?;
    let start = core.start();
    let mut handoff = !idle_only;
    loop {
        let mut state = control.lock().map_err(|_| "update admission state is poisoned")?;
        if state.cancelled() { return Ok(false); }
        if process.exited_within(Duration::ZERO) {
            return Err("the engine exited before admitting the update; nothing was installed".into());
        }
        if !same_core(pid, &start) || health(core.port, pid).is_none() || !same_core(pid, &start) {
            return Err("the live engine did not answer as the expected core; nothing was installed".into());
        }
        if !still()? { return Ok(false); }
        if handoff {
            match request_shutdown("/shutdown-for-update", core.port, &core.token, pid)? {
                Admission::Accepted => {}
                _ => { handoff = false; continue; }
            }
        } else {
            match request_shutdown("/shutdown-if-idle", core.port, &core.token, pid)? {
                Admission::Accepted => {}
                Admission::Busy if idle_only => return Ok(false),
                Admission::Busy => {
                    drop(state);
                    std::thread::sleep(Duration::from_millis(250));
                    continue;
                }
                Admission::Unsupported => return Err("the engine refused safe update admission (HTTP 404); stop it explicitly before installing".into()),
            }
        }
        *state = InstallState::Committed;
        committed();
        drop(state);
        if !process.exited_within(if handoff { HANDOFF_EXIT } else { crate::resident::GRACE }) {
            return Err("the engine accepted the update but did not exit; nothing was installed".into());
        }
        return Ok(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};
    use std::sync::Arc;

    const SCRIPT: &str = r#"
import { existsSync } from 'node:fs';
const [dir, mode] = process.argv.slice(2);
const server = Bun.serve({ hostname:'127.0.0.1', port:0, fetch(request) {
 const url = new URL(request.url);
 if (url.pathname === '/health') return Response.json({ok:true,pid:process.pid,version:'test'});
 if (url.pathname === '/shutdown-for-update') {
  if (mode !== 'handoff') return new Response('missing',{status:404});
  setTimeout(() => process.exit(0),300);
  return Response.json({ok:true,pid:process.pid},{status:202});
 }
 if (url.pathname === '/shutdown-if-idle') {
  if (mode === 'legacy') return new Response('missing',{status:404});
  if (!existsSync(`${dir}/idle`)) return new Response('busy',{status:409});
  setTimeout(() => process.exit(0),30);
  return Response.json({ok:true,pid:process.pid},{status:202});
 }
 return new Response('no',{status:404});
}}); console.log(server.port);
"#;

    struct Fixture { child: Child, directory: std::path::PathBuf }
    impl Fixture {
        fn new(name: &str, mode: &str) -> Self {
            let directory = std::env::temp_dir().join(format!("boite-update-{name}-{}", std::process::id()));
            std::fs::create_dir_all(&directory).unwrap();
            let script = directory.join("core.ts"); std::fs::write(&script, SCRIPT).unwrap();
            let _ = std::fs::remove_file(directory.join("idle"));
            let mut command = Command::new("bun");
            command.arg(&script).arg(&directory).arg(mode).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
            crate::platform::prepare_command(&mut command);
            let mut child = command.spawn().unwrap();
            let mut port = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut port).unwrap();
            std::fs::write(directory.join("core.json"), format!(r#"{{"pid":{},"port":{},"token":"fixture"}}"#, child.id(), port.trim())).unwrap();
            Self { child, directory }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); let _ = std::fs::remove_dir_all(&self.directory); }
    }

    #[test]
    fn an_exited_core_with_a_retained_handle_cannot_admit_an_update() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("exit-before-admission", "handoff");
        let pid = fixture.child.id();
        let watched = Watched::open(pid).unwrap();
        fixture.child.kill().unwrap();
        assert!(watched.exited_within(Duration::from_secs(3)));
        // Keep the Child and the watch alive through admission. Windows can
        // still open the exited process, as POSIX can before the Child is reaped.
        assert!(Watched::open(pid).unwrap().exited_within(Duration::ZERO));
        let control = Mutex::new(InstallState::Waiting);
        let committed = std::cell::Cell::new(false);
        let result = stop_for_update(&fixture.directory, &control, false, || Ok(true), || committed.set(true));
        assert!(result.is_err(), "the exited core admitted an update: {result:?}");
        assert!(!committed.get());
        assert!(*control.lock().unwrap() == InstallState::Waiting);
    }

    #[test]
    fn a_busy_core_with_the_handoff_stops_on_the_first_request() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("handoff", "handoff");
        let control = Mutex::new(InstallState::Waiting);
        // No `idle` file: the idle admission would answer busy for ever.
        assert!(stop_for_update(&fixture.directory, &control, false, || Ok(true), || {}).unwrap());
        assert_eq!(fixture.child.wait().unwrap().code(), Some(0));
        let mut state = control.lock().unwrap();
        assert!(*state == InstallState::Committed);
        assert!(!state.webview_failed(), "an accepted handoff must finish first");
        let result = launch_if_allowed(|| Ok(()), || Err("installer did not launch".into()));
        assert_eq!(result.unwrap_err(), "installer did not launch");
        assert!(state.finish(), "a failed installer launch must recover the dead webview");
        assert!(!state.finish());
    }
    #[test]
    fn cancellation_leaves_a_busy_core_running() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("cancel", "current");
        let control = Arc::new(Mutex::new(InstallState::Waiting));
        let other = control.clone(); let directory = fixture.directory.clone();
        let waiter = std::thread::spawn(move || stop_for_update(&directory, &other, false, || Ok(true), || panic!("cancelled install committed")));
        std::thread::sleep(Duration::from_millis(100));
        *control.lock().unwrap() = InstallState::Cancelled;
        assert!(!waiter.join().unwrap().unwrap());
        assert!(fixture.child.try_wait().unwrap().is_none());
    }

    #[test]
    fn a_webview_crash_cancels_admission_to_a_busy_core_before_restarting_the_shell() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("webview-crash-during-admission", "current");
        let control = Arc::new(Mutex::new(InstallState::Waiting));
        let (checked, admitted) = std::sync::mpsc::channel();
        let other = control.clone();
        let directory = fixture.directory.clone();
        let waiter = std::thread::spawn(move || {
            stop_for_update(&directory, &other, false, || {
                let _ = checked.send(());
                Ok(true)
            }, || panic!("the busy core must stay running"))
        });
        admitted.recv_timeout(Duration::from_secs(3)).unwrap();
        admitted.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(!control.lock().unwrap().webview_failed());
        assert!(!waiter.join().unwrap().unwrap());
        assert!(fixture.child.try_wait().unwrap().is_none());
        assert!(control.lock().unwrap().finish());
        assert!(!control.lock().unwrap().start());
    }
    #[test]
    fn busy_work_finishes_before_the_core_exits_on_its_own() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("finish", "current");
        let control = Arc::new(Mutex::new(InstallState::Waiting));
        let other = control.clone(); let directory = fixture.directory.clone();
        let waiter = std::thread::spawn(move || stop_for_update(&directory, &other, false, || Ok(true), || {}));
        std::thread::sleep(Duration::from_millis(100));
        assert!(fixture.child.try_wait().unwrap().is_none());
        std::fs::write(fixture.directory.join("idle"), "").unwrap();
        assert!(waiter.join().unwrap().unwrap());
        assert_eq!(fixture.child.wait().unwrap().code(), Some(0));
        assert!(*control.lock().unwrap() == InstallState::Committed);
    }
    #[test]
    fn an_install_nobody_asked_for_leaves_a_busy_core_running_and_stops_an_idle_one() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("quiet", "handoff");
        let control = Mutex::new(InstallState::Waiting);
        // The handoff would stop it at once: an automatic install never asks for it.
        assert!(!stop_for_update(&fixture.directory, &control, true, || Ok(true), || panic!("a busy core was stopped")).unwrap());
        assert!(fixture.child.try_wait().unwrap().is_none());
        std::fs::write(fixture.directory.join("idle"), "").unwrap();
        // The window came back while the install waited: an idle core keeps running too.
        assert!(!stop_for_update(&fixture.directory, &control, true, || Ok(false), || panic!("a shown window was closed")).unwrap());
        assert!(fixture.child.try_wait().unwrap().is_none());
        assert!(stop_for_update(&fixture.directory, &control, true, || Ok(true), || {}).unwrap());
        assert_eq!(fixture.child.wait().unwrap().code(), Some(0));
        assert!(*control.lock().unwrap() == InstallState::Committed);
    }

    #[test]
    fn a_policy_change_while_a_manual_install_waits_leaves_the_core_running() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("policy-during-admission", "idle");
        let control = Mutex::new(InstallState::Waiting);
        let checks = std::cell::Cell::new(0);
        let stopped = stop_for_update(&fixture.directory, &control, false, || {
            checks.set(checks.get() + 1);
            if checks.get() == 1 { Ok(true) } else { Err("updates.app is now off".into()) }
        }, || panic!("the updated policy prohibits admission"));
        assert_eq!(stopped.unwrap_err(), "updates.app is now off");
        assert!(fixture.child.try_wait().unwrap().is_none());
        assert!(*control.lock().unwrap() == InstallState::Waiting);
    }

    #[test]
    fn a_policy_change_during_an_accepted_handoff_refuses_to_launch_the_installer() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("policy-during-handoff", "handoff");
        let mut state = InstallState::Idle;
        assert!(state.start());
        let control = Mutex::new(state);
        let blocked = std::cell::Cell::new(false);
        assert!(stop_for_update(&fixture.directory, &control, false, || Ok(!blocked.get()), || {
            blocked.set(true);
        }).unwrap());
        assert_eq!(fixture.child.wait().unwrap().code(), Some(0));
        let result = launch_if_allowed(|| {
            if blocked.get() { Err("updates.app is now off".into()) } else { Ok(()) }
        }, || panic!("the updated policy prohibits launching the installer"));
        assert_eq!(result.unwrap_err(), "updates.app is now off");
    }
    #[cfg(unix)]
    fn scratch(name: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!("boite-update-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[cfg(unix)]
    #[test]
    fn a_core_older_than_the_os_lock_stays_out_until_the_update_lets_go() {
        let _guard = crate::process_test_guard();
        let directory = scratch("legacy-lock");
        let path = directory.join("core.lock");
        let lock = lock_without_core(&directory).unwrap().expect("no core runs on the directory");
        let record: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let pid = std::process::id();
        assert_eq!((record["pid"].as_u64(), record["osLock"].as_bool()), (Some(pid.into()), Some(true)));
        assert_eq!(record["startKey"].as_str().map(str::to_string), crate::platform::process::start_key(pid));
        assert_eq!(legacy_core::start(&directory), format!("busy {pid}"));
        assert!(lock_without_core(&directory).unwrap().is_none(), "a second update took the held lock");
        drop(lock);
        assert!(!path.exists(), "the record outlived the update");
        // A cancelled or failed install takes it again from a free directory, then the older core starts.
        drop(lock_without_core(&directory).unwrap().expect("the lock was let go"));
        assert_eq!(legacy_core::start(&directory), "started");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_update_never_writes_or_removes_the_record_of_a_core_that_replaced_the_file() {
        let directory = scratch("replaced-lock");
        let path = directory.join("core.lock");
        let other = r#"{"pid":1,"startedAt":0}"#;
        let lock = lock_without_core(&directory).unwrap().unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, other).unwrap();
        drop(lock);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), other);
        // Replaced between the judgement and the record: the record lands in the old file only.
        let judged = OpenOptions::new().read(true).write(true).open(&path).unwrap();
        judged.try_lock().unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, other).unwrap();
        assert!(InstallLock::publish(judged, path.clone(), std::process::id(), None).unwrap().is_none());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), other);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn an_older_core_without_idle_admission_is_never_killed() {
        let _guard = crate::process_test_guard();
        let mut fixture = Fixture::new("legacy", "legacy");
        let control = Mutex::new(InstallState::Waiting);
        assert!(stop_for_update(&fixture.directory, &control, false, || Ok(true), || {}).unwrap_err().contains("404"));
        assert!(fixture.child.try_wait().unwrap().is_none());
    }
}
