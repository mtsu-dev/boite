/**
 * Ties each agent's process group to the core on Linux before the agent runs,
 * through the launcher in native/launch.c. The sh watcher (posix-group-watch.ts)
 * learns a group only once `Bun.spawn` returned and the registry wrote its pid:
 * a core that dies in between leaves that group untied, and the watcher signals
 * pid numbers, which the kernel hands out again once a group is empty.
 *
 * Here Bun starts the launcher in the agent's place, as the leader of a new
 * session. Before it execs the agent it opens a pidfd on itself and hands it
 * to the one guard the core runs, over a socket (SCM_RIGHTS). So the group is
 * tied before the agent's first instruction, and the guard signals the group
 * through that pidfd (PIDFD_SIGNAL_PROCESS_GROUP), never through a number.
 * The spawn reads a pipe until the exec closes it: it returns once the agent
 * runs, or throws the launch's errno in Bun's own shape.
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
  pipe2(fds: unknown, flags: number): number;
  read(fd: number, buffer: unknown, length: bigint | number): number | bigint;
  sendmsg(fd: number, message: unknown, flags: number): number | bigint;
  close(fd: number): number;
  __errno_location(): unknown;
}

const O_CLOEXEC = 0o2000000;
const SOCK_SEQPACKET = 5;
const AF_UNIX = 1;
const MSG_DONTWAIT = 0x40;
const MSG_NOSIGNAL = 0x4000;
const EINTR = 4;

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
};

/** The error Bun.spawn throws for `errno`, as the launcher reported it. */
export function spawnError(errno: number, cmd0: string): Error & { code: string; errno: number; syscall: string; path: string } {
  const [code, text] = ERRORS[errno] ?? [`E${errno}`, 'unknown error'];
  return Object.assign(new Error(`${code}: ${text}, posix_spawn '${cmd0}'`), { code, errno: -errno, syscall: 'posix_spawn', path: cmd0 });
}

/** `process.kill`, signal 0 probes. Throws like it. */
type Signal = (pid: number, signal: NodeJS.Signals | 0) => void;
const answers = (signal: Signal, pid: number): boolean => {
  try { signal(pid, 0); return true; } catch (error) { return (error as { code?: unknown }).code === 'EPERM'; }
};

type Stdio = 'ignore' | 'pipe' | 'inherit' | number;
export interface LaunchOptions {
  cmd: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  stdio: Stdio[];
}

/** The guard's end, and the launcher; one per core process. */
export class NativeTie {
  #libc: Libc | null = null;
  #launcher: string | null = null;
  #sock = -1;
  #guard: { exited: Promise<number>; unref(): void } | null = null;
  #refusal: string | null | undefined;
  #seq = 0;
  /** Each group the guard holds, by its leader's pid: its tag, and whether its leader still runs. */
  readonly #held = new Map<number, { tag: number; leading: boolean }>();
  #poll: ReturnType<typeof setInterval> | null = null;
  /** Called with the groups the guard held when it is found gone (pid, leader still running), for the sh watcher to take. */
  onLost: (groups: Array<[number, boolean]>) => void = () => {};

  constructor(
    private readonly candidates = launcherCandidates(),
    private readonly kernel = process.platform === 'linux' ? release() : '',
    private readonly signal: Signal = (pid, signal) => { process.kill(pid, signal); },
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
      const { dlopen, FFIType: T } = require('bun:ffi') as typeof import('bun:ffi');
      this.#libc = dlopen('libc.so.6', {
        socketpair: { args: [T.i32, T.i32, T.i32, T.ptr], returns: T.i32 },
        pipe2: { args: [T.ptr, T.i32], returns: T.i32 },
        read: { args: [T.i32, T.ptr, T.u64], returns: T.i64 },
        sendmsg: { args: [T.i32, T.ptr, T.i32], returns: T.i64 },
        close: { args: [T.i32], returns: T.i32 },
        __errno_location: { args: [], returns: T.ptr },
      }).symbols as unknown as Libc;
    } catch (error) {
      return `libc.so.6: ${error instanceof Error ? error.message : String(error)}`;
    }
    return this.#startGuard();
  }

  #startGuard(): string | null {
    const libc = this.#libc!;
    const pair = new Int32Array(2);
    if (libc.socketpair(AF_UNIX, SOCK_SEQPACKET | O_CLOEXEC, 0, pair) < 0) return 'socketpair failed';
    try {
      const guard = Bun.spawn({ cmd: [this.#launcher!, 'guard'], stdio: [pair[1]!, 'ignore', 'ignore'], detached: true, cwd: '/' });
      // The guard holds nothing back: the core's exit is what it waits for.
      guard.unref();
      this.#guard = guard;
      const sock = pair[0]!;
      this.#sock = sock;
      void guard.exited.then(() => { if (this.#sock === sock) this.#lose(); });
      return null;
    } catch (error) {
      libc.close(pair[0]!);
      return `the guard did not start: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      libc.close(pair[1]!);
    }
  }

  /** The guard is gone: its groups go to the sh watcher, and the next spawn starts another guard. */
  #lose(): void {
    if (this.#sock >= 0) this.#libc?.close(this.#sock);
    this.#sock = -1;
    this.#guard = null;
    const groups = [...this.#held].map(([pid, { leading }]): [number, boolean] => [pid, leading]);
    this.#held.clear();
    if (groups.length > 0) this.onLost(groups);
  }

  /** Whether the guard holds `pid`'s group. */
  holds(pid: number): boolean { return this.#held.has(pid); }

  /**
   * `Bun.spawn` of `options.cmd` through the launcher, its group tied before
   * the agent runs; null when this tie is not ready, for a plain spawn. Bun's
   * own `detached` is set: the launcher leads the agent's session and group.
   */
  spawn(options: LaunchOptions): Bun.Subprocess | null {
    if (this.ready() !== null) return null;
    if (this.#sock < 0 && this.#startGuard() !== null) return null;
    try {
      return this.#launch(options);
    } catch (error) {
      if ((error as { launcherGuardLost?: unknown }).launcherGuardLost !== true) throw error;
      // The guard died since the last spawn: the launch failed closed, before the agent ran. Once more with a new guard.
      this.#lose();
      if (this.#startGuard() !== null) return null;
      return this.#launch(options);
    }
  }

  #launch(options: LaunchOptions): Bun.Subprocess {
    const libc = this.#libc!;
    const [cmd0, ...rest] = options.cmd;
    if (cmd0 === undefined) throw new TypeError('cmd must not be empty');
    const path = cmd0.includes('/') ? cmd0 : Bun.which(cmd0, { PATH: options.env.PATH ?? '', ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
    if (path === null) throw Object.assign(new Error(`Executable not found in $PATH: "${cmd0}"`), { code: 'ENOENT', errno: -2, path: cmd0 });
    const status = new Int32Array(2);
    if (libc.pipe2(status, O_CLOEXEC) < 0) throw new Error('pipe2 failed');
    const tag = (this.#seq = (this.#seq % 0xffff_fffe) + 1);
    const n = options.stdio.length;
    let proc: Bun.Subprocess;
    try {
      proc = Bun.spawn({
        cmd: [this.#launcher!, 'launch', String(n), String(n + 1), String(tag), path, cmd0, ...rest],
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        env: options.env,
        stdio: [...options.stdio, status[1]!, this.#sock] as never,
        detached: true,
      });
    } catch (error) {
      libc.close(status[0]!);
      throw error;
    } finally {
      libc.close(status[1]!);
    }
    const errno = new Int32Array(1);
    let read: number;
    while ((read = Number(libc.read(status[0]!, errno, 4))) < 0 && this.#errno() === EINTR) { /* again */ }
    libc.close(status[0]!);
    if (read === 4) {
      // The guard may hold the group already (an exec that failed after the send): it drops it.
      this.#forget(tag);
      const error = spawnError(errno[0]!, cmd0);
      if (errno[0] === 32) Object.assign(error, { launcherGuardLost: true });
      throw error;
    }
    this.#held.set(proc.pid, { tag, leading: true });
    return proc;
  }

  #errno(): number {
    const { toArrayBuffer } = require('bun:ffi') as typeof import('bun:ffi');
    const location = this.#libc!.__errno_location();
    return location === null ? 0 : new Int32Array(toArrayBuffer(location as never, 0, 4))[0]!;
  }

  #forget(tag: number): void {
    if (this.#sock < 0) return;
    const { ptr } = require('bun:ffi') as typeof import('bun:ffi');
    const data = new Uint32Array([tag]);
    const iov = new BigUint64Array([BigInt(ptr(data)), 4n]);
    const message = new BigUint64Array(7); // struct msghdr: name, namelen, iov, iovlen, control, controllen, flags
    message[2] = BigInt(ptr(iov));
    message[3] = 1n;
    this.#libc!.sendmsg(this.#sock, message, MSG_NOSIGNAL | MSG_DONTWAIT);
  }

  /** The group is empty, or the keeper holds it for the next core: the guard drops it. */
  release(pid: number): void {
    const held = this.#held.get(pid);
    if (held === undefined) return;
    this.#held.delete(pid);
    this.#forget(held.tag);
  }

  /** The leader exited: the guard holds its group until it is empty, as the sh watcher does (posix-group-watch.ts). */
  leaderExited(pid: number): void {
    const held = this.#held.get(pid);
    if (held === undefined || !held.leading) return;
    held.leading = false;
    if (this.#poll === null) {
      this.#poll = setInterval(() => this.sweep(), this.pollMs);
      this.#poll.unref();
    }
  }

  /**
   * Drops each group whose leader exited and that has no member left. The
   * kernel keeps a group's id while it has a member, so a live process with
   * that pid proves the group emptied. Only the core's view of the number is
   * racy here: the guard signals through the pidfd, never a stranger.
   */
  sweep(): void {
    for (const [pid, { leading }] of this.#held) {
      if (!leading && (answers(this.signal, pid) || !answers(this.signal, -pid))) this.release(pid);
    }
    if (this.#poll !== null && ![...this.#held.values()].some(held => !held.leading)) { clearInterval(this.#poll); this.#poll = null; }
  }

  /** SIGKILL to every held group now, for an exit that cannot wait out the guard's grace. */
  killAll(): void {
    for (const [pid, { leading }] of this.#held) {
      if (!leading && answers(this.signal, pid)) continue;
      try { this.signal(-pid, 'SIGKILL'); } catch { /* Already empty. */ }
    }
  }
}
