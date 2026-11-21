//! A core older than the OS lock at its start: `takeLock` before the lock was an OS one (704c675c,
//! packages/core/src/data-lock.ts). It opens `core.lock` with `wx`; a file already there it reads,
//! and unless the record names a live process of the run that wrote it, it unlinks the file and
//! tries again. The run is judged as it judged it, with a start time it cannot read.
use std::path::Path;
use std::process::{Command, Stdio};

const SCRIPT: &str = r#"
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
const file = process.argv[2];
const startKey = pid => {
  try {
    const ticks = readFileSync(`/proc/${pid}/stat`, 'utf8').split(')').pop().trim().split(/\s+/)[19];
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${ticks}`;
  } catch { return null; }
};
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
for (let attempt = 0; attempt < 2; attempt += 1) {
  try {
    const handle = openSync(file, 'wx');
    writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    closeSync(handle);
    console.log('started');
    process.exit(0);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let holder = null, lockedAt = null, lockedKey = null;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      holder = typeof parsed.pid === 'number' ? parsed.pid : null;
      lockedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : null;
      lockedKey = typeof parsed.startKey === 'string' ? parsed.startKey : null;
    } catch { holder = null; }
    const key = lockedKey === null ? null : startKey(holder);
    const sameRun = key !== null ? key === lockedKey : !(lockedAt !== null && lockedAt < Date.now() - uptime() * 1000 - 2000);
    if (holder !== null && holder !== process.pid && alive(holder) && sameRun) {
      console.log(`busy ${holder}`);
      process.exit(0);
    }
    rmSync(file, { force: true });
  }
}
console.log('it keeps coming back');
"#;

/// What that core does on `directory`: `started` once it took the lock (its record stays, naming
/// a process that has exited), or `busy <pid>`.
pub(crate) fn start(directory: &Path) -> String {
    let script = directory.join("legacy-core.mjs");
    std::fs::write(&script, SCRIPT).unwrap();
    let mut command = Command::new("bun");
    command.arg(&script).arg(directory.join("core.lock")).stdin(Stdio::null()).stderr(Stdio::inherit());
    crate::platform::prepare_command(&mut command);
    let output = command.output().unwrap();
    assert!(output.status.success(), "the older core failed: {:?}", output.status);
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}
