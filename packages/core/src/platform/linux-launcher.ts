/**
 * Ties each agent's process group to the core on Linux before the agent runs,
 * through the launcher in native/launch.c. The sh watcher (posix-group-watch.ts)
 * learns a group only once `Bun.spawn` returned and the registry wrote its pid:
 * a core that dies in between leaves that group untied, and the watcher signals
 * pid numbers, which the kernel hands out again once a group is empty.
 *
 * Here Bun starts the launcher in the agent's place, as the leader of a new
 * session. Before it execs the agent it opens a pidfd on itself, hands it to
 * the one guard the core runs over a socket (SCM_RIGHTS) and waits for the
 * guard to answer that it holds it; then it hands the same pidfd to the core.
 * So the group is tied before the agent's first instruction, and both the
 * guard and the core signal it through that pidfd (PIDFD_SIGNAL_PROCESS_GROUP),
 * never through a number. The spawn reads its status socket until the exec
 * closes it: it returns once the agent runs, tied, or throws the launch's
 * errno in Bun's own shape; anything else stops the launch and throws.
 *
 * The core keeps its own pidfd of every group it holds, so a guard that is
 * gone, stopped, or that cannot take a drop never costs a group its identity:
 * the core starts another guard, hands it every group still held, and only
 * then stops the old one. A group no guard takes back stays held here by its
 * pidfd, said through `onTrouble`, and is offered again until one does; it
 * ends with a stop, never with a core that dies meanwhile. A drop that no
 * guard can take keeps the group held and says so to its caller. The one
 * window left: a core that dies after its guard died and before it started
 * the next leaves those groups untied.
 *
 * Needs Linux 6.9 (PIDFD_SIGNAL_PROCESS_GROUP), glibc's libc.so.6 for the few
 * socket calls Bun has no API for, and the launcher next to the compiled core
 * or built into native/build. Without one of these, `ready` says why and the
 * sh watcher ties groups as before, with its window.
 */
import { accessSync, constants, readFileSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join } from 'node:path';

export const LAUNCHER_NAME = 'boite-launch';

/** Where the launcher is looked for: next to the compiled core, then the source tree's build. */
export function launcherCandidates(execPath = process.execPath, here = import.meta.dir): string[] {
  return [join(dirname(execPath), LAUNCHER_NAME), join(here, '..', '..', 'native', 'build', LAUNCHER_NAME)];
}

function findLauncher(candidates: string[]): string | null {
  for (const path of candidates) {
    try { accessSync(path, constants.X_OK); return path; } catch { /* next */ }
  }
  return null;
}

/** Linux 6.9 added PIDFD_SIGNAL_PROCESS_GROUP; an older kernel would refuse every group signal. */
export function kernelSignalsGroups(release: string): boolean {
  const [major, minor] = release.split(/[.-]/).map(Number);
  return major! > 6 || (major === 6 && minor! >= 9);
}

interface Libc {
  poll(fds: unknown, count: number, timeout: number): number;
  socketpair(domain: number, type: number, protocol: number, fds: unknown): number;
  recvmsg(fd: number, message: unknown, flags: number): number | bigint;
  sendmsg(fd: number, message: unknown, flags: number): number | bigint;
  close(fd: number): number;
  syscall(number: number | bigint, a: number, b: number, c: number | bigint, d: number): number | bigint;
  __errno_location(): unknown;
}

const SOCK_CLOEXEC = 0o2000000;
const SOCK_SEQPACKET = 5;
const AF_UNIX = 1;
const SOL_SOCKET = 1;
const SCM_RIGHTS = 1;
const MSG_DONTWAIT = 0x40;
const MSG_NOSIGNAL = 0x4000;
const MSG_CMSG_CLOEXEC = 0x40000000;
const EINTR = 4;
const ESRCH = 3;
const EPIPE = 32;
const ECONNRESET = 104;
const SIGTERM = 15;
const POLLIN = 1;
/** How often a wait on the guard or the launcher looks whether that process was stopped: not a deadline, a running one is waited for. */
const STOP_CHECK_MS = 50;
/** What Bun searches for a bare name when the child's PATH is unset or empty. */
const BUN_DEFAULT_PATH = '/usr/bin:/bin';
const PIDFD_SIGNAL_PROCESS_GROUP = 4;
/** pidfd_send_signal: the same number on every Linux architecture since 5.1. */
const SYS_PIDFD_SEND_SIGNAL = 424;
const SIGKILL = 9;

/** errno to Bun's own code and text for a failed posix_spawn, so a caller sees the same error. */
const ERRORS: Record<number, [string, string]> = {
  1: ['EPERM', 'operation not permitted'],
  2: ['ENOENT', 'no such file or directory'],
  7: ['E2BIG', 'argument list too long'],
  8: ['ENOEXEC', 'unknown error'],
  12: ['ENOMEM', 'cannot allocate memory'],
  13: ['EACCES', 'permission denied'],
  20: ['ENOTDIR', 'not a directory'],
  21: ['EISDIR', 'is a directory'],
  26: ['ETXTBSY', 'text file is busy'],
  32: ['EPIPE', 'broken pipe'],
  40: ['ELOOP', 'too many symbolic links encountered'],
  36: ['ENAMETOOLONG', 'name too long'],
  23: ['ENFILE', 'file table overflow'],
  24: ['EMFILE', 'too many open files'],
};

/** The error Bun.spawn throws for `errno`, as the launcher reported it. */
export function spawnError(errno: number, cmd0: string): Error & { code: string; errno: number; syscall: string; path: string } {
  const [code, text] = ERRORS[errno] ?? [`E${errno}`, 'unknown error'];
  return Object.assign(new Error(`${code}: ${text}, posix_spawn '${cmd0}'`), { code, errno: -errno, syscall: 'posix_spawn', path: cmd0 });
}

type Stdio = 'ignore' | 'pipe' | 'inherit' | number;
export interface LaunchOptions {
  cmd: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  stdio: Stdio[];
}

/** The launcher's steps (native/launch.c): the one a failure names. */
const enum Step { Admitted = 0, Setup = 1, Guard = 2, Exec = 3 }

/** What a launch's status socket carried: the pidfd the launcher sent, a failed step and its errno, or neither. */
interface Status { fd: number | null; failed: { step: number; errno: number } | null; closed: boolean; broken: number | null }

interface Guard { proc: Bun.Subprocess; sock: number }

/** A group held: its leader's pid, the core's own pidfd of it, whether its leader still runs, whether the registry took it, and the guard that holds it too, if any. */
interface Held { pid: number; fd: number; leading: boolean; claimed: boolean; guard: Guard | null }

/** The errno-like value of a wait given up because the process it waits on is stopped. */
const STOPPED = -1;

/** Whether `pid` is stopped by a signal or a tracer: what it was asked may never be answered. */
function stopped(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
    return state === 'T' || state === 't';
  } catch { return false; }
}

/** The guard's end, and the launcher; one per core process. */
export class NativeTie {
  #libc: Libc | null = null;
  #ffi: typeof import('bun:ffi') | null = null;
  #launcher: string | null = null;
  #guard: Guard | null = null;
  #refusal: string | null | undefined;
  #seq = 0;
  /** Each group held, by the tag of its admission. */
  readonly #held = new Map<number, Held>();
  /** The tag of the latest group launched under each pid. */
  readonly #byPid = new Map<number, number>();
  #poll: ReturnType<typeof setInterval> | null = null;
  #recovery: ReturnType<typeof setInterval> | null = null;
  readonly #troubles = new Set<(message: string) => void>();

  constructor(
    private readonly candidates = launcherCandidates(),
    private readonly kernel = process.platform === 'linux' ? release() : '',
    private readonly pollMs = 1000,
  ) {}

  /** Each time groups stay held by the core alone, or a group cannot be let go of, why. */
  onTrouble(listener: (message: string) => void): () => void {
    this.#troubles.add(listener);
    return () => { this.#troubles.delete(listener); };
  }

  #trouble(message: string): void { for (const listener of this.#troubles) listener(message); }

  /** Starts the guard once; why groups cannot be tied this way, or null. */
  ready(): string | null {
    if (this.#refusal !== undefined) return this.#refusal;
    this.#refusal = this.#start();
    return this.#refusal;
  }

  #start(): string | null {
    if (process.platform !== 'linux') return 'not Linux';
    if (!kernelSignalsGroups(this.kernel)) return `Linux ${this.kernel} cannot signal a group through a pidfd (6.9 or later)`;
    this.#launcher = findLauncher(this.candidates);
    if (this.#launcher === null) return `no ${LAUNCHER_NAME} next to the core (${this.candidates.join(', ')})`;
    try {
      this.#ffi = require('bun:ffi') as typeof import('bun:ffi');
      const T = this.#ffi.FFIType;
      this.#libc = this.#ffi.dlopen('libc.so.6', {
        poll: { args: [T.ptr, T.u64, T.i32], returns: T.i32 },
        socketpair: { args: [T.i32, T.i32, T.i32, T.ptr], returns: T.i32 },
        recvmsg: { args: [T.i32, T.ptr, T.i32], returns: T.i64 },
        sendmsg: { args: [T.i32, T.ptr, T.i32], returns: T.i64 },
        close: { args: [T.i32], returns: T.i32 },
        syscall: { args: [T.i64, T.i32, T.i32, T.u64, T.u32], returns: T.i64 },
        __errno_location: { args: [], returns: T.ptr },
      }).symbols as unknown as Libc;
    } catch (error) {
      return `libc.so.6: ${error instanceof Error ? error.message : String(error)}`;
    }
    const guard = this.#startGuard();
    if (typeof guard === 'string') return guard;
    this.#guard = guard;
    return this.#probe();
  }

  /**
   * One launch of the launcher itself, which waits to be killed: pidfd_open
   * and the guard's admission, then signal 0 from the core, SIGTERM and
   * SIGKILL from the guard, through the pidfd, must all work, or a syscall
   * filter would leave every group untied without a word.
   */
  #probe(): string | null {
    let proc: Bun.Subprocess;
    try { proc = this.#launch({ cmd: [this.#launcher!, 'probe'], env: {}, stdio: ['ignore', 'ignore', 'ignore'] }, this.#guard!); } catch (error) {
      this.#stopGuard();
      return `the launcher could not tie a group: ${error instanceof Error ? error.message : String(error)}`;
    }
    const tag = this.#byPid.get(proc.pid)!;
    const held = this.#held.get(tag)!;
    const refused = (() => {
      const own = this.#signal(held.fd, 0);
      if (own !== true) return `a group signal through a pidfd fails: errno ${own}`;
      for (const signal of [SIGTERM, SIGKILL]) {
        const answer = this.#request(this.#guard!, new Uint32Array([tag, signal]), null, tag);
        if (answer !== 0) return `the guard cannot send signal ${signal} to a group: errno ${answer}`;
      }
      return null;
    })();
    this.#signal(held.fd, SIGKILL);
    // By number too, through kill(2): a filter that refused the pidfd's signals must not leave the probe waiting.
    try { process.kill(proc.pid, 'SIGKILL'); } catch { /* gone */ }
    this.#drop(tag);
    if (refused !== null) this.#stopGuard();
    return refused;
  }

  #stopGuard(): void {
    const guard = this.#guard;
    this.#guard = null;
    if (guard === null) return;
    guard.proc.kill('SIGKILL');
    this.#libc!.close(guard.sock);
  }

  #errno(): number {
    const location = this.#libc!.__errno_location();
    return location === null ? 0 : new Int32Array(this.#ffi!.toArrayBuffer(location as never, 0, 4))[0]!;
  }

  #pair(): [number, number] | string {
    const pair = new Int32Array(2);
    if (this.#libc!.socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, pair) < 0) return `socketpair: errno ${this.#errno()}`;
    return [pair[0]!, pair[1]!];
  }

  #startGuard(): Guard | string {
    const libc = this.#libc!;
    const pair = this.#pair();
    if (typeof pair === 'string') return pair;
    try {
      const proc = Bun.spawn({ cmd: [this.#launcher!, 'guard'], stdio: [pair[1], 'ignore', 'ignore'], detached: true, cwd: '/' });
      // The guard holds nothing back: the core's exit is what it waits for.
      proc.unref();
      const guard = { proc, sock: pair[0] };
      void proc.exited.then(() => { if (this.#guard === guard) this.#replace(null, true); });
      return guard;
    } catch (error) {
      libc.close(pair[0]);
      return `the guard did not start: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      libc.close(pair[1]);
    }
  }

  /** One message of `data`, with `fd` when given; the errno when it was not sent, or 0. */
  #send(sock: number, data: Uint32Array | Int32Array, fd: number | null, flags: number): number {
    const { ptr } = this.#ffi!;
    const iov = new BigUint64Array([BigInt(ptr(data)), BigInt(data.byteLength)]);
    const control = new BigUint64Array(3); // CMSG_SPACE(sizeof(int)) = 24: len, level and type, the fd
    const message = new BigUint64Array(7); // struct msghdr: name, namelen, iov, iovlen, control, controllen, flags
    message[2] = BigInt(ptr(iov));
    message[3] = 1n;
    if (fd !== null) {
      control[0] = 20n; // CMSG_LEN(sizeof(int))
      new Int32Array(control.buffer, 8, 3).set([SOL_SOCKET, SCM_RIGHTS, fd]);
      message[4] = BigInt(ptr(control));
      message[5] = 24n;
    }
    for (;;) {
      if (Number(this.#libc!.sendmsg(sock, message, flags | MSG_NOSIGNAL)) >= 0) return 0;
      const errno = this.#errno();
      if (errno !== EINTR) return errno;
    }
  }

  /**
   * Waits until `sock` has something to read, its end or an error included;
   * false once one of `watched` is stopped first, as a SIGSTOP or a tracer
   * leaves it, so a stopped guard or launcher never holds the core's loop.
   */
  #readable(sock: number, watched: number[]): boolean {
    const fds = new Int32Array([sock, POLLIN]); // struct pollfd: fd, then events and revents as two shorts
    for (;;) {
      fds[1] = POLLIN;
      const ready = this.#libc!.poll(fds, 1, STOP_CHECK_MS);
      if (ready > 0) return true;
      if (ready < 0 && this.#errno() !== EINTR) return true; // recvmsg says what is wrong
      if (watched.some(stopped)) return false;
    }
  }

  /** One message into `data`: its length (0 at end of input), the fd it carried, or the errno; STOPPED when one of `watched` stopped first. */
  #receive(sock: number, data: Int32Array, watched: number[] = []): { length: number; fd: number | null; truncated: boolean } | { errno: number } {
    const { ptr } = this.#ffi!;
    const iov = new BigUint64Array([BigInt(ptr(data)), BigInt(data.byteLength)]);
    const control = new BigUint64Array(3);
    const message = new BigUint64Array(7);
    message[2] = BigInt(ptr(iov));
    message[3] = 1n;
    message[4] = BigInt(ptr(control));
    message[5] = 24n;
    for (;;) {
      if (!this.#readable(sock, watched)) return { errno: STOPPED };
      const length = Number(this.#libc!.recvmsg(sock, message, MSG_CMSG_CLOEXEC | MSG_DONTWAIT));
      if (length < 0) {
        const errno = this.#errno();
        if (errno === EINTR || errno === 11) continue; // EAGAIN: another reader took it
        return { errno };
      }
      const [level, type, fd] = new Int32Array(control.buffer, 8, 3);
      const carried = Number(message[5]) >= 20 && control[0] === 20n && level === SOL_SOCKET && type === SCM_RIGHTS ? fd! : null;
      return { length, fd: carried, truncated: (Number(message[6]! & 0xffffffffn) & 0x8) !== 0 }; // MSG_CTRUNC
    }
  }

  /** Sends `data` (and `fd`) to the guard and reads its answer for `tag`: 0, an errno, or STOPPED when the guard stopped before it answered. */
  #request(guard: Guard, data: Uint32Array, fd: number | null, tag: number): number {
    const sent = this.#send(guard.sock, data, fd, 0);
    if (sent !== 0) return sent;
    const answer = new Int32Array(2);
    for (;;) {
      const got = this.#receive(guard.sock, answer, [guard.proc.pid]);
      if ('errno' in got) return got.errno;
      if (got.fd !== null) this.#libc!.close(got.fd);
      if (got.length === 0) return EPIPE;
      if (got.length === 8 && answer[0]! >>> 0 === tag) return answer[1]!;
      // A stale answer, for a launch that died before it read it.
    }
  }

  /**
   * A new guard that holds every group still held but `drop`, then the old
   * one stopped: no group is ever without a guard while the core lives. A
   * group the new guard refuses stays held here, by its pidfd, offered again
   * later. When no new guard starts, a guard still alive (`oldGone` false)
   * keeps all it holds; false then, and nothing changed.
   */
  #replace(drop: number | null, oldGone: boolean): boolean {
    const old = this.#guard;
    let next: Guard | string = this.#startGuard();
    const refused: number[] = [];
    if (typeof next !== 'string') {
      for (const [tag, held] of this.#held) {
        if (tag === drop) continue;
        const answer = this.#request(next, new Uint32Array([tag]), held.fd, tag);
        if (answer === STOPPED || answer === EPIPE || answer === ECONNRESET) {
          // Stopped or gone while it took them back: this guard is no better than none.
          next.proc.kill('SIGKILL');
          this.#libc!.close(next.sock);
          next = `the new guard ${answer === STOPPED ? 'was stopped' : 'ended'} as it took the groups back`;
          break;
        }
        if (answer !== 0) refused.push(answer);
        else held.guard = next;
      }
    }
    if (typeof next === 'string') {
      if (!oldGone && old !== null) {
        this.#trouble(`agent groups stay with the guard that could not take a drop: ${next}`);
        return false;
      }
      this.#guard = null;
      if (old !== null) { old.proc.kill('SIGKILL'); this.#libc!.close(old.sock); }
      for (const held of this.#held.values()) held.guard = null;
      if (this.#held.size > 0) this.#trouble(`${this.#held.size} agent group(s) are held by the core alone, no guard started: ${next}`);
      this.#recover();
      return false;
    }
    this.#guard = next;
    if (old !== null) {
      // SIGKILL: an old guard that saw its input close would end every group it holds.
      old.proc.kill('SIGKILL');
      this.#libc!.close(old.sock);
    }
    if (refused.length > 0) {
      this.#trouble(`${refused.length} agent group(s) are held by the core alone, the new guard refused them (errno ${refused[0]})`);
      this.#recover();
    }
    return true;
  }

  /** Offers the groups no guard holds again, every `pollMs`, until one does: without waiting for a spawn. */
  #recover(): void {
    if (this.#recovery !== null) return;
    this.#recovery = setInterval(() => {
      if (this.#guard === null) this.#replace(null, true);
      const guard = this.#guard;
      if (guard !== null) {
        for (const [tag, held] of this.#held) {
          if (held.guard === guard) continue;
          const answer = this.#request(guard, new Uint32Array([tag]), held.fd, tag);
          if (answer === 0) held.guard = guard;
          else if (answer === STOPPED || answer === EPIPE || answer === ECONNRESET) { this.#replace(null, true); break; }
        }
      }
      if (this.#guard !== null && [...this.#held.values()].every(held => held.guard === this.#guard)) { clearInterval(this.#recovery!); this.#recovery = null; }
    }, this.pollMs);
    this.#recovery.unref();
  }

  /** Whether `pid`'s group is held here. */
  holds(pid: number): boolean { return this.#byPid.has(pid); }

  /** Whether the guard holds `pid`'s group too, so that it ends with a core that dies. */
  guarded(pid: number): boolean {
    const tag = this.#byPid.get(pid);
    return tag !== undefined && this.#guard !== null && this.#held.get(tag)!.guard === this.#guard;
  }

  /**
   * The registry takes the group `spawn` just launched as `pid`: true. Any
   * other `pid` false, for the watcher; a group still held under that number
   * from an earlier launch is over (the kernel gave the number back) and
   * goes.
   */
  claim(pid: number): boolean {
    const tag = this.#byPid.get(pid);
    if (tag === undefined) return false;
    const held = this.#held.get(tag)!;
    if (!held.claimed) { held.claimed = true; return true; }
    this.#byPid.delete(pid);
    held.leading = false;
    this.#drop(tag);
    return false;
  }

  /** The running guard's pid, for diagnostics. */
  get guardPid(): number | null { return this.#guard?.proc.pid ?? null; }

  /**
   * `Bun.spawn` of `options.cmd` through the launcher, its group tied before
   * the agent runs; null when this tie is not ready, for a plain spawn. Bun's
   * own `detached` is set: the launcher leads the agent's session and group.
   */
  spawn(options: LaunchOptions): Bun.Subprocess | null {
    if (this.ready() !== null) return null;
    if (this.#guard === null && !this.#replace(null, true)) return null;
    const used = this.#guard!;
    try {
      return this.#launch(options, used);
    } catch (error) {
      if ((error as { launcherMissing?: unknown }).launcherMissing === true) {
        // Gone since it was found: groups are tied after their spawn from now on, as without it.
        this.#refusal = error instanceof Error ? error.message : String(error);
        return null;
      }
      if ((error as { launcherGuardLost?: unknown }).launcherGuardLost !== true) throw error;
      // The guard died or was stopped since the last spawn: the launch failed before the agent ran. Once more with a new guard.
      if (this.#guard === null || this.#guard === used) {
        if (!this.#replace(null, true)) return null;
      }
      return this.#launch(options, this.#guard!);
    }
  }

  #launch(options: LaunchOptions, guard: Guard): Bun.Subprocess {
    const libc = this.#libc!;
    const [cmd0, ...rest] = options.cmd;
    if (cmd0 === undefined) throw new TypeError('cmd must not be empty');
    // Bun's own lookup: the child's PATH, relative entries from its cwd, and Bun's default when PATH is unset or empty.
    const path = cmd0.includes('/') ? cmd0 : Bun.which(cmd0, { PATH: options.env.PATH || BUN_DEFAULT_PATH, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
    if (path === null) throw Object.assign(new Error(`Executable not found in $PATH: "${cmd0}"`), { code: 'ENOENT', errno: -2, path: cmd0 });
    const pair = this.#pair();
    if (typeof pair === 'string') throw new Error(`the launch's status socket: ${pair}`);
    const tag = (this.#seq = (this.#seq % 0xffff_fffe) + 1);
    const n = options.stdio.length;
    let proc: Bun.Subprocess;
    try {
      proc = Bun.spawn({
        cmd: [this.#launcher!, 'launch', String(n), String(n + 1), String(tag), path, cmd0, ...rest],
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        env: options.env,
        stdio: [...options.stdio, pair[1], guard.sock] as never,
        detached: true,
      });
    } catch (error) {
      libc.close(pair[0]);
      // Bun names the program it could not start; a launcher gone since it was found is not the agent's error.
      if (findLauncher([this.#launcher!]) === null) throw Object.assign(new Error(`${LAUNCHER_NAME} is gone: ${error instanceof Error ? error.message : String(error)}`), { launcherMissing: true });
      throw error;
    } finally {
      libc.close(pair[1]);
    }
    // The kernel gives a number back only once its group is empty: a group still listed under it is over, dropped once
    // the new one is held under its own tag, so that a guard replaced by that drop takes the new one along.
    const stale = this.#byPid.get(proc.pid);
    const status = this.#status(pair[0], proc, guard, tag);
    libc.close(pair[0]);
    if (stale !== undefined && stale !== tag && this.#held.has(stale)) {
      if (this.#byPid.get(proc.pid) === stale) this.#byPid.delete(proc.pid);
      this.#held.get(stale)!.leading = false;
      this.#drop(stale);
    }
    if (status.closed && status.fd !== null && status.failed === null) return proc;
    // The agent never runs untied: a failure stops before its exec; an unreadable outcome ends the group now.
    if (status.fd !== null) {
      if (status.failed === null) this.#signal(status.fd, SIGKILL);
      // Held from its admission on, by its tag: it goes the way any group goes.
      const held = this.#byPid.get(proc.pid) === tag;
      if (held) { this.#byPid.delete(proc.pid); this.#held.get(tag)!.leading = false; this.#drop(tag); } else libc.close(status.fd);
    }
    const guardLost = status.failed !== null && status.failed.step === Step.Guard && (status.failed.errno === EPIPE || status.failed.errno === ECONNRESET);
    // A guard that is gone holds nothing; any other may hold the tag already (a failure after admission).
    if (!guardLost && status.fd === null) this.#forget(tag);
    if (status.failed !== null) {
      const error = spawnError(status.failed.errno, cmd0);
      if (guardLost) Object.assign(error, { launcherGuardLost: true });
      throw error;
    }
    // No pidfd: the launcher never had the core's word, so it never ran the agent, and it is alone in its group.
    if (status.fd === null) proc.kill('SIGKILL');
    throw Object.assign(new Error(status.broken === null
      ? `${LAUNCHER_NAME} ended before it reported the launch of '${cmd0}'`
      : `the launch of '${cmd0}' could not be read: ${status.broken === STOPPED ? 'the launcher was stopped' : `errno ${status.broken}`}`), { code: 'ELAUNCH', path: cmd0 });
  }

  /**
   * The launch's status socket until it closes: the pidfd first, which the
   * core holds under the launch's tag before it tells the launcher to go on,
   * then the exec's close; or an errno. Any other message, a short one or a
   * read error is `broken` or not `closed`, never a success. A guard stopped
   * while the launcher may wait on it is replaced, which fails that wait.
   */
  #status(sock: number, proc: Bun.Subprocess, guard: Guard, tag: number): Status {
    const status: Status = { fd: null, failed: null, closed: false, broken: null };
    const data = new Int32Array(2);
    for (;;) {
      const watched = status.fd === null && this.#guard === guard ? [proc.pid, guard.proc.pid] : [proc.pid];
      const got = this.#receive(sock, data, watched);
      if ('errno' in got) {
        if (got.errno === STOPPED && !stopped(proc.pid)) { this.#replace(null, true); continue; }
        status.broken = got.errno;
        return status;
      }
      if (got.length === 0) { status.closed = true; return status; }
      const admitted = got.length === 8 && !got.truncated && data[0] === Step.Admitted && data[1] === 0 && got.fd !== null && status.fd === null;
      if (admitted) {
        status.fd = got.fd;
        const held: Held = { pid: proc.pid, fd: got.fd!, leading: true, claimed: false, guard: this.#guard === guard ? guard : null };
        this.#held.set(tag, held);
        this.#byPid.set(proc.pid, tag);
        // The guard it was admitted to was replaced meanwhile: the new one takes it before the agent runs.
        if (this.#guard === null) { status.broken = EPIPE; return status; }
        if (held.guard !== this.#guard) {
          const answer = this.#request(this.#guard, new Uint32Array([tag]), held.fd, tag);
          if (answer !== 0) { status.broken = answer; return status; }
          held.guard = this.#guard;
        }
        if (this.#send(sock, new Int32Array([1]), null, 0) !== 0) { status.broken = this.#errno(); return status; }
        continue;
      }
      if (got.fd !== null) this.#libc!.close(got.fd);
      if (got.length === 8 && !got.truncated && data[0]! > Step.Admitted && data[0]! <= Step.Exec && data[1]! > 0) status.failed = { step: data[0]!, errno: data[1]! };
      else status.broken = 0;
      return status;
    }
  }

  /** pidfd_send_signal to the group: true when delivered, else the errno. */
  #signal(fd: number, signal: number): true | number {
    if (Number(this.#libc!.syscall(SYS_PIDFD_SEND_SIGNAL, fd, signal, 0, PIDFD_SIGNAL_PROCESS_GROUP)) === 0) return true;
    return this.#errno();
  }

  /** Drops a tag the core holds no pidfd for (a launch that failed after its admission). */
  #forget(tag: number): void {
    const guard = this.#guard;
    if (guard === null) return;
    if (this.#send(guard.sock, new Uint32Array([tag]), null, MSG_DONTWAIT) !== 0) this.#replace(tag, false);
  }

  /**
   * Lets go of the group held under `tag`: the guard drops it, or, when it
   * does not take the drop at once, a new guard that never holds it replaces
   * it. False when neither could be done: the group stays held, by the old
   * guard too, and ends with the core.
   */
  #drop(tag: number): boolean {
    const held = this.#held.get(tag);
    if (held === undefined) return true;
    const guard = this.#guard;
    if (guard !== null && held.guard === guard && this.#send(guard.sock, new Uint32Array([tag]), null, MSG_DONTWAIT) !== 0 && !this.#replace(tag, false)) {
      if (!held.leading) this.#sweepSoon();
      return false;
    }
    this.#held.delete(tag);
    if (this.#byPid.get(held.pid) === tag) this.#byPid.delete(held.pid);
    this.#libc!.close(held.fd);
    return true;
  }

  /** The group is empty, or the keeper holds it for the next core: no guard holds it any more. False when it stays held (`#drop`). */
  release(pid: number): boolean {
    const tag = this.#byPid.get(pid);
    if (tag === undefined) return true;
    const dropped = this.#drop(tag);
    if (!dropped) this.#trouble(`the group of ${pid} could not be let go of: it ends with this core`);
    return dropped;
  }

  /** The leader exited: its group stays held until it is empty, as the sh watcher does (posix-group-watch.ts). */
  leaderExited(pid: number): void {
    const tag = this.#byPid.get(pid);
    const held = tag === undefined ? undefined : this.#held.get(tag);
    if (held === undefined || !held.leading) return;
    held.leading = false;
    this.#sweepSoon();
  }

  #sweepSoon(): void {
    if (this.#poll !== null) return;
    this.#poll = setInterval(() => this.sweep(), this.pollMs);
    this.#poll.unref();
  }

  /** Drops each group whose leader exited and that has no member left, probed through its pidfd. */
  sweep(): void {
    for (const [tag, held] of this.#held) {
      if (!held.leading && this.#signal(held.fd, 0) === ESRCH) this.#drop(tag);
    }
    if (this.#poll !== null && ![...this.#held.values()].some(held => !held.leading)) { clearInterval(this.#poll); this.#poll = null; }
  }

  /** SIGKILL to every held group now, through its pidfd, for an exit that cannot wait out the guard's grace. */
  killAll(): void {
    for (const held of this.#held.values()) this.#signal(held.fd, SIGKILL);
  }
}
