#!/usr/bin/env bun
/**
 * Inside the server image, under Docker's default seccomp filter: the group
 * launcher beside bun, its probe, then real agents whose groups end with the
 * core that launched them, each core killed by SIGKILL.
 *
 * - The production route: `NativeTie.spawn`, or a detached spawn when it
 *   refuses, then `claim` or the sh watcher (`GroupWatch.add`), as procs.ts
 *   `#start` and posix.ts `tieGroup` do. The probe's own answer picks the
 *   case. Ready: the agent must be admitted natively. A refusal that names
 *   the kernel (before 6.9), or a pidfd syscall the filter denies (EPERM,
 *   EINVAL, ENOSYS) that also fails with that errno when this process calls
 *   it: the agent must fall back to the watcher, and no native admission is
 *   claimed. Any other refusal (a launcher missing, that does not run, that
 *   does not speak this core's protocol, or whose setup or exec fails while
 *   pidfds work) fails the smoke.
 * - The watcher alone, on every kernel: the route of PTY, node and keeper
 *   spawns, and the one the fallback takes.
 *
 * docker/smoke.sh copies this file, linux-launcher.ts and posix-group-watch.ts
 * next to each other.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dir;
const { NativeTie, launcherCandidates } = await import(join(here, 'linux-launcher.ts'));
const fail = (message: string): never => { console.error(`launcher smoke: ${message}`); process.exit(1); };

const launcher = '/usr/local/bin/boite-launch';
if (launcherCandidates()[0] !== launcher) fail(`bun looks for ${launcherCandidates()[0]}, not ${launcher}`);
if (!existsSync(launcher)) fail(`${launcher} is missing`);
const mode = statSync(launcher).mode & 0o7777;
if (mode !== 0o755) fail(`${launcher} has mode ${mode.toString(8)}, not 755`);
// It runs: without arguments the launcher only answers its usage, exit 2. So an EPERM below is a syscall, not its exec.
let usage: { exitCode: number | null; signalCode?: string | null };
try { usage = Bun.spawnSync([launcher], { stdout: 'ignore', stderr: 'ignore' }); } catch (error) { usage = fail(`${launcher} does not run: ${(error as Error).message}`); }
if (usage.exitCode !== 2) fail(`${launcher} without arguments ended with ${usage.signalCode ?? usage.exitCode}, not its usage exit 2`);

/**
 * pidfd_open and a group pidfd_send_signal of signal 0, made here on a child
 * of this process under the same filter as the launcher: 0 when the syscall
 * works, else its errno; `signal` is null when no pidfd could be opened.
 */
function pidfdCounterProbe(): { open: number; signal: number | null } {
  const { dlopen, FFIType: T, read } = require('bun:ffi') as typeof import('bun:ffi');
  const libc = dlopen('libc.so.6', {
    syscall: { args: [T.i64, T.i32, T.i32, T.u64, T.u32], returns: T.i64 },
    close: { args: [T.i32], returns: T.i32 },
    __errno_location: { args: [], returns: T.ptr },
  }).symbols;
  const errno = () => read.i32(libc.__errno_location()!, 0);
  const child = Bun.spawn({ cmd: ['sleep', '30'], stdio: ['ignore', 'ignore', 'ignore'], detached: true });
  try {
    const fd = Number(libc.syscall(434, child.pid, 0, 0, 0));
    if (fd < 0) return { open: errno(), signal: null };
    // PIDFD_SIGNAL_PROCESS_GROUP (4): the flag the launcher, the guard and the core use.
    const sent = Number(libc.syscall(424, fd, 0, 0, 4));
    const signal = sent === 0 ? 0 : errno();
    libc.close(fd);
    return { open: 0, signal };
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

const PIDFD_ERRNOS = new Set([1, 22, 38]);
const LAUNCH_ERRNO: Record<string, number> = { 'EPERM: operation not permitted': 1, 'E22: unknown error': 22, 'E38: unknown error': 38 };

/**
 * The refusals that leave the core on the watcher by design, each confirmed by
 * the counter-probe: a denied pidfd syscall must fail here too, with the same
 * errno. Else why the smoke fails. The launch's generic error ("could not tie
 * a group: EPERM ...") also stands for a failed fcntl or exec in the launcher,
 * so it counts as a pidfd_open refusal only when pidfd_open fails here as well.
 */
function fallback(refusal: string, probe: () => { open: number; signal: number | null }): { kind: 'kernel' | 'pidfd'; detail: string } | { fail: string } {
  if (/^Linux \S+ cannot signal a group through a pidfd \(6\.9 or later\)$/.test(refusal)) return { kind: 'kernel', detail: 'kernel before 6.9' };
  const signal = /^a group signal through a pidfd fails: errno (\d+)$/.exec(refusal) ?? /^the guard cannot send signal (?:9|15) to a group: errno (\d+)$/.exec(refusal);
  const head = 'the launcher could not tie a group: ', tail = `, posix_spawn '${launcher}'`;
  const launch = refusal.startsWith(head) && refusal.endsWith(tail) ? refusal.slice(head.length, -tail.length) : null;
  const named = signal ? Number(signal[1]) : launch !== null ? LAUNCH_ERRNO[launch] : undefined;
  if (named === undefined || !PIDFD_ERRNOS.has(named)) return { fail: `the native tie refused for a reason that is no kernel or pidfd limit: ${refusal}` };
  const counter = probe();
  const seen = signal ? counter.signal : counter.open;
  const syscall = signal ? 'pidfd_send_signal' : 'pidfd_open';
  if (seen !== named) return { fail: `the native tie refused (${refusal}), yet ${syscall} here ${seen === 0 ? 'works' : seen === null ? 'was not reached' : `fails with errno ${seen}`}: not a pidfd refusal` };
  return { kind: 'pidfd', detail: `${syscall} fails here too with errno ${seen}` };
}

const kernel = release();
const refusal: string | null = new NativeTie().ready();
const native = refusal === null;
const decided = refusal === null ? null : fallback(refusal, pidfdCounterProbe);
if (decided !== null && 'fail' in decided) fail(decided.fail);
const { kind, detail } = decided !== null && 'kind' in decided ? decided : { kind: null, detail: '' };

interface Admission { why?: string; pid: number; held: boolean; guarded: boolean; pgrp: number; sid: number; guard: number | null; watchers: number[] }

/** One agent spawned by a core of its own, which then dies by SIGKILL. */
async function admit(route: 'production' | 'watcher'): Promise<Admission> {
  const core = Bun.spawn({
    cmd: [process.execPath, '-e', `
      const { readFileSync, readdirSync } = await import('node:fs');
      const { NativeTie } = await import(${JSON.stringify(join(here, 'linux-launcher.ts'))});
      const { GroupWatch } = await import(${JSON.stringify(join(here, 'posix-group-watch.ts'))});
      const tie = new NativeTie(), groups = new GroupWatch();
      const why = groups.ready();
      if (why !== null) { console.log(JSON.stringify({ why })); process.exit(0); }
      const options = { cmd: ['sleep', '300'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] };
      const detached = () => Bun.spawn({ ...options, detached: true });
      const agent = ${route === 'production' ? 'tie.spawn(options) ?? detached()' : 'detached()'};
      if (!tie.claim(agent.pid)) groups.add(agent.pid);
      const fields = pid => readFileSync('/proc/' + pid + '/stat', 'utf8').replace(/^.*\\) /, '').split(' ');
      const stat = fields(agent.pid);
      // The sh watcher: this core's child that runs its script.
      const watchers = readdirSync('/proc').filter(p => /^\\d+$/.test(p)).map(Number).filter(p => {
        try { return Number(fields(p)[1]) === process.pid && readFileSync('/proc/' + p + '/cmdline', 'utf8').includes('trap'); } catch { return false; }
      });
      console.log(JSON.stringify({ pid: agent.pid, held: tie.holds(agent.pid), guarded: tie.guarded(agent.pid), pgrp: Number(stat[2]), sid: Number(stat[3]), guard: tie.holds(agent.pid) ? tie.guardPid : null, watchers }));
      process.kill(process.pid, 'SIGKILL');`],
    stdout: 'pipe', stderr: 'inherit',
  });
  const out = JSON.parse((await new Response(core.stdout).text()).trim()) as Admission;
  await core.exited;
  if (out.why !== undefined) fail(`${route}: the sh watcher did not start: ${out.why}`);
  if (core.signalCode !== 'SIGKILL') fail(`${route}: the core ended with ${core.signalCode ?? core.exitCode}, not SIGKILL`);
  if (out.pgrp !== out.pid) fail(`${route}: agent ${out.pid} is in group ${out.pgrp}, not its own`);
  // Gone, or a zombie that tini has not reaped yet. The watcher's grace is two seconds.
  const ended = (pid: number) => { try { return /^[ZX]$/.test(readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '')[0]!); } catch { return true; } };
  const tracked = [out.pid, ...(out.guard !== null ? [out.guard] : []), ...out.watchers];
  for (let i = 0; i < 100 && !tracked.every(ended); i++) await Bun.sleep(100);
  if (!ended(out.pid)) { try { process.kill(-out.pid, 'SIGKILL'); } catch { /* gone */ } fail(`${route}: agent ${out.pid} outlived its core`); }
  for (const pid of tracked.slice(1)) if (!ended(pid)) fail(`${route}: ${pid === out.guard ? 'guard' : 'watcher'} ${pid} outlived its core`);
  return out;
}

const production = await admit('production');
if (native) {
  if (!production.held || !production.guarded) fail(`agent ${production.pid}: held=${production.held} guarded=${production.guarded}, not admitted natively`);
  if (production.sid !== production.pid) fail(`agent ${production.pid} is in session ${production.sid}, not its own`);
} else if (production.held || production.watchers.length !== 1) {
  // Not held natively, it ended with its core through the watcher alone.
  fail(`${kind} refusal: agent ${production.pid} held=${production.held} after the refusal, ${production.watchers.length} watchers`);
}
const watched = await admit('watcher');
if (watched.held || watched.watchers.length !== 1) fail(`watcher route: agent ${watched.pid} held=${watched.held}, ${watched.watchers.length} watchers`);

console.log(native
  ? `launcher smoke: Linux ${kernel}, probe ready under the default filter; agent ${production.pid} admitted natively in its own group and session, ended with its core; watched agent ${watched.pid} ended with its core`
  : `launcher smoke: Linux ${kernel}, ${kind} refusal (${refusal}; ${detail}); agent ${production.pid} fell back to the sh watcher and ended with its core, no native admission claimed; watched agent ${watched.pid} ended with its core`);
