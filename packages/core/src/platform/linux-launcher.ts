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
 * gone, or a drop the guard could not take, never costs a group its identity:
 * the core starts another guard, hands it every group still held, and only
 * then stops the old one.
 *
 * Needs Linux 6.9 (PIDFD_SIGNAL_PROCESS_GROUP), glibc's libc.so.6 for the few
 * socket calls Bun has no API for, and the launcher next to the compiled core
 * or built into native/build. Without one of these, `ready` says why and the
 * sh watcher ties groups as before, with its window.
 */
import { accessSync, constants } from 'node:fs';
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

/** The guard's end, and the launcher; one per core process. */
export class NativeTie {
  #libc: Libc | null = null;
  #ffi: typeof import('bun:ffi') | null = null;
  #launcher: string | null = null;
  #guard: Guard | null = null;
  #refusal: string | null | undefined;
  #seq = 0;
  /** Each group held, by its leader's pid: its tag, the core's own pidfd of it, and whether its leader still runs. */
  readonly #held = new Map<number, { tag: number; fd: number; leading: boolean; claimed: boolean }>();
  #poll: ReturnType<typeof setInterval> | null = null;
  /** Called with the groups no guard could take back (pid, leader still running), for the sh watcher to take. */
  onLost: (groups: Array<[number, boolean]>) => void = () => {};

  constructor(
    private readonly candidates = launcherCandidates(),
    private readonly kernel = process.platform === 'linux' ? release() : '',
    private readonly pollMs = 1000,
  ) {}

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
   * One launch of the launcher itself, which exits at once: pidfd_open, the
   * guard's admission and a group signal through the pidfd must all work, or
   * a syscall filter would leave every group untied without a word.
   */
  #probe(): string | null {
    let proc: Bun.Subprocess;
    try { proc = this.#launch({ cmd: [this.#launcher!, 'probe'], env: {}, stdio: ['ignore', 'ignore', 'ignore'] }); } catch (error) {
      this.#stopGuard();
      return `the launcher could not tie a group: ${error instanceof Error ? error.message : String(error)}`;
    }
    const held = this.#held.get(proc.pid)!;
    const signalled = this.#signal(held.fd, 0);
    this.release(proc.pid);
    // Bun has not reaped it in this turn, so its group still has it: anything but success is a refusal.
    if (signalled !== true) { this.#stopGuard(); return `a group signal through a pidfd fails: errno ${signalled}`; }
    return null;
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
      void proc.exited.then(() => { if (this.#guard === guard) this.#replace(); });
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

  /** One message into `data`, blocking: its length (0 at end of input), the fd it carried, or the errno. */
  #receive(sock: number, data: Int32Array): { length: number; fd: number | null; truncated: boolean } | { errno: number } {
    const { ptr } = this.#ffi!;
    const iov = new BigUint64Array([BigInt(ptr(data)), BigInt(data.byteLength)]);
    const control = new BigUint64Array(3);
    const message = new BigUint64Array(7);
    message[2] = BigInt(ptr(iov));
    message[3] = 1n;
    message[4] = BigInt(ptr(control));
    message[5] = 24n;
    for (;;) {
      const length = Number(this.#libc!.recvmsg(sock, message, MSG_CMSG_CLOEXEC));
      if (length < 0) {
        const errno = this.#errno();
        if (errno === EINTR) continue;
        return { errno };
      }
      const [level, type, fd] = new Int32Array(control.buffer, 8, 3);
      const carried = Number(message[5]) >= 20 && control[0] === 20n && level === SOL_SOCKET && type === SCM_RIGHTS ? fd! : null;
      return { length, fd: carried, truncated: (Number(message[6]! & 0xffffffffn) & 0x8) !== 0 }; // MSG_CTRUNC
    }
  }

  /** Hands the guard the group `fd` names under `tag`, and reads its answer: 0 when it holds it, or the errno. */
  #admit(guard: Guard, tag: number, fd: number): number {
    const sent = this.#send(guard.sock, new Uint32Array([tag]), fd, 0);
    if (sent !== 0) return sent;
    const answer = new Int32Array(2);
    for (;;) {
      const got = this.#receive(guard.sock, answer);
      if ('errno' in got) return got.errno;
      if (got.fd !== null) this.#libc!.close(got.fd);
      if (got.length === 0) return EPIPE;
      if (got.length === 8 && answer[0]! >>> 0 === tag) return answer[1]!;
      // A stale answer, for a launch that died before it read it.
    }
  }

  /**
   * A new guard that holds every group still held, then the old one stopped:
   * no group is ever without a guard while the core lives. A group the new
   * guard refuses goes to the sh watcher, as untied as the watcher's window.
   * False when no guard could start.
   */
  #replace(): boolean {
    const old = this.#guard;
    const next = this.#startGuard();
    if (typeof next === 'string') {
      this.#guard = null;
      if (old !== null) { this.#libc!.close(old.sock); }
      return false;
    }
    const refused: Array<[number, boolean]> = [];
    for (const [pid, held] of this.#held) {
      if (this.#admit(next, held.tag, held.fd) === 0) continue;
      refused.push([pid, held.leading]);
      this.#libc!.close(held.fd);
      this.#held.delete(pid);
    }
    this.#guard = next;
    if (old !== null) {
      // SIGKILL: an old guard that saw its input close would end every group it holds.
      old.proc.kill('SIGKILL');
      this.#libc!.close(old.sock);
    }
    if (refused.length > 0) this.onLost(refused);
    return true;
  }

  /** Whether `pid`'s group is held here. */
  holds(pid: number): boolean { return this.#held.has(pid); }

  /**
   * The registry takes the group `spawn` just launched as `pid`: true. Any
   * other `pid` false, for the watcher; a group still held under that number
   * from an earlier launch is over (the kernel gave the number back) and
   * goes.
   */
  claim(pid: number): boolean {
    const held = this.#held.get(pid);
    if (held === undefined) return false;
    if (!held.claimed) { held.claimed = true; return true; }
    this.release(pid);
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
    if (this.#guard === null && !this.#replace()) return null;
    try {
      return this.#launch(options);
    } catch (error) {
      if ((error as { launcherMissing?: unknown }).launcherMissing === true) {
        // Gone since it was found: groups are tied after their spawn from now on, as without it.
        this.#refusal = error instanceof Error ? error.message : String(error);
        return null;
      }
      if ((error as { launcherGuardLost?: unknown }).launcherGuardLost !== true) throw error;
      // The guard died since the last spawn: the launch failed before the agent ran. Once more with a new guard.
      if (!this.#replace()) return null;
      return this.#launch(options);
    }
  }

  #launch(options: LaunchOptions): Bun.Subprocess {
    const libc = this.#libc!;
    const guard = this.#guard!;
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
    const status = this.#status(pair[0]);
    libc.close(pair[0]);
    if (status.closed && status.fd !== null && status.failed === null) {
      // The kernel gives a number back only once its group is empty: a group still listed under it is over.
      if (this.#held.has(proc.pid)) this.release(proc.pid);
      this.#held.set(proc.pid, { tag, fd: status.fd, leading: true, claimed: false });
      return proc;
    }
    // The agent never runs untied: a failure stops before its exec; an unreadable outcome ends the group now.
    if (status.fd !== null) {
      if (status.failed === null) this.#signal(status.fd, SIGKILL);
      libc.close(status.fd);
    }
    const guardLost = status.failed !== null && status.failed.step === Step.Guard && (status.failed.errno === EPIPE || status.failed.errno === ECONNRESET);
    // A guard that is gone holds nothing; any other may hold the tag already (a failure after admission).
    if (!guardLost) this.#forget(tag);
    if (status.failed !== null) {
      const error = spawnError(status.failed.errno, cmd0);
      if (guardLost) Object.assign(error, { launcherGuardLost: true });
      throw error;
    }
    if (status.fd === null) proc.kill('SIGKILL');
    throw Object.assign(new Error(status.broken === null
      ? `${LAUNCHER_NAME} ended before it reported the launch of '${cmd0}'`
      : `the launch of '${cmd0}' could not be read: errno ${status.broken}`), { code: 'ELAUNCH', path: cmd0 });
  }

  /**
   * The launch's status socket until it closes: the pidfd first, then the
   * exec's close; or an errno. Any other message, a short one or a read error
   * is `broken` or not `closed`, never a success.
   */
  #status(sock: number): Status {
    const status: Status = { fd: null, failed: null, closed: false, broken: null };
    const data = new Int32Array(2);
    for (;;) {
      const got = this.#receive(sock, data);
      if ('errno' in got) { status.broken = got.errno; return status; }
      if (got.length === 0) { status.closed = true; return status; }
      const admitted = got.length === 8 && !got.truncated && data[0] === Step.Admitted && data[1] === 0 && got.fd !== null && status.fd === null;
      if (admitted) { status.fd = got.fd; continue; }
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

  /** Drops `tag` from the guard. A guard that does not take it now is replaced by one that never held it. */
  #forget(tag: number): void {
    const guard = this.#guard;
    if (guard === null) return;
    if (this.#send(guard.sock, new Uint32Array([tag]), null, MSG_DONTWAIT) !== 0) this.#replace();
  }

  /** The group is empty, or the keeper holds it for the next core: no guard holds it any more. */
  release(pid: number): void {
    const held = this.#held.get(pid);
    if (held === undefined) return;
    this.#held.delete(pid);
    this.#libc!.close(held.fd);
    this.#forget(held.tag);
  }

  /** The leader exited: its group stays held until it is empty, as the sh watcher does (posix-group-watch.ts). */
  leaderExited(pid: number): void {
    const held = this.#held.get(pid);
    if (held === undefined || !held.leading) return;
    held.leading = false;
    if (this.#poll === null) {
      this.#poll = setInterval(() => this.sweep(), this.pollMs);
      this.#poll.unref();
    }
  }

  /** Drops each group whose leader exited and that has no member left, probed through its pidfd. */
  sweep(): void {
    for (const [pid, held] of this.#held) {
      if (!held.leading && this.#signal(held.fd, 0) === ESRCH) this.release(pid);
    }
    if (this.#poll !== null && ![...this.#held.values()].some(held => !held.leading)) { clearInterval(this.#poll); this.#poll = null; }
  }

  /** SIGKILL to every held group now, through its pidfd, for an exit that cannot wait out the guard's grace. */
  killAll(): void {
    for (const held of this.#held.values()) this.#signal(held.fd, SIGKILL);
  }
}
