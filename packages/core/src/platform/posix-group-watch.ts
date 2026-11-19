/**
 * Ties each agent process group to the core's life on Linux and macOS, as
 * `KILL_ON_JOB_CLOSE` does on Windows. Every child the registry spawns leads a
 * process group of its own (posix-kill.ts), so nothing the kernel does on the
 * core's death reaches it: a crash, a SIGKILL, the OOM killer or the shutdown
 * deadline left every agent and what it started running, unseen by the next core.
 *
 * One `sh` per core reads the groups on a pipe from the core: `+ pid` when a
 * group starts, `x pid` once its leader's exit is recorded, `- pid` once the
 * group is empty or the keeper takes it over. A leader that exits leaves its
 * tools in the group, so the group stays watched until a probe finds it
 * empty. Only builtins run while the core lives. End of input means the core
 * is gone: the watcher sends SIGTERM to each group it still holds, probes them
 * every tenth of a second for two seconds as `stopGroup` does, then sends
 * SIGKILL to what is left, and exits.
 *
 * A group id is its leader's pid, which the kernel never hands out while the
 * group has a member. So for a group whose leader exited, a live process with
 * that pid proves the group emptied and the id went to a stranger: the group
 * is dropped, never signalled. A probe of that pid the kernel refuses (EPERM,
 * another user's process) counts as a stranger too; only "No such process"
 * leaves the group ours. A new spawn that gets the pid back watches it again
 * as a running group.
 *
 * The watcher starts before the first spawn and leads a session of its own. It
 * ignores the signals a terminal sends, so a Ctrl+C that reaches the core's
 * group does not end it first.
 */

/** The watcher's script; `$g` holds groups whose leader runs, `$e` those whose leader exited, each pid between spaces. */
export const GROUP_WATCH_SCRIPT = `trap '' INT TERM HUP QUIT
LC_ALL=C; export LC_ALL
gone() { case $(kill -s 0 "$1" 2>&1) in *'No such process'*) return 0 ;; esac; return 1; }
g=' ' e=' '
while read -r op pid; do
  case $pid in ''|*[!0-9]*) continue ;; esac
  case $g in *" $pid "*) g="\${g%% $pid *} \${g#* $pid }" ;; esac
  case $e in *" $pid "*) e="\${e%% $pid *} \${e#* $pid }" ;; esac
  case $op in +) g="$g$pid " ;; x) e="$e$pid " ;; esac
done
for p in $e; do gone "$p" && g="$g$p "; done
for p in $g; do kill -s TERM -- -"$p" 2>/dev/null; done
i=0
while [ $i -lt 20 ]; do
  left=
  for p in $g; do kill -s 0 -- -"$p" 2>/dev/null && left="$left $p"; done
  g=$left
  [ -z "$g" ] && exit 0
  sleep 0.1
  i=$((i + 1))
done
for p in $g; do kill -s KILL -- -"$p" 2>/dev/null; done
`;

/** Where the lines go. */
export type WatchWriter = (line: string) => void;

function startWatcher(): WatchWriter {
  const shell = Bun.which('sh');
  if (shell === null) throw new Error('no sh on PATH');
  const watcher = Bun.spawn({ cmd: [shell, '-c', GROUP_WATCH_SCRIPT], env: { ...process.env, LC_ALL: 'C' }, stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', detached: true });
  // Neither the watcher nor its pipe holds the core's exit back: that exit is what it waits for.
  watcher.unref();
  (watcher.stdin as unknown as { unref?: () => void }).unref?.();
  let gone = false;
  void watcher.exited.then(() => { gone = true; });
  return (line) => {
    if (gone) return;
    watcher.stdin.write(line);
    void watcher.stdin.flush();
  };
}

/** `process.kill`, signal 0 probes. Throws like it. */
type Signal = (pid: number, signal: NodeJS.Signals | 0) => void;

const answers = (signal: Signal, pid: number): boolean => {
  try { signal(pid, 0); return true; } catch (error) { return (error as { code?: unknown }).code === 'EPERM'; }
};

/** How often groups whose leader exited are probed for members. */
export const EMPTY_POLL_MS = 1000;

export class GroupWatch {
  #writer: WatchWriter | null | undefined;
  /** Each watched group: true while its leader runs, false once its exit was recorded. */
  readonly #watched = new Map<number, boolean>();
  #poll: ReturnType<typeof setInterval> | null = null;

  /** `start` runs once, before the first spawn: no process at core startup. */
  constructor(
    private readonly start: () => WatchWriter = startWatcher,
    private readonly signal: Signal = (pid, signal) => { process.kill(pid, signal); },
    private readonly pollMs = EMPTY_POLL_MS,
  ) {}

  /** Starts the watcher; why it could not, once, or null. Agents then run untied, as before it existed. */
  ready(): string | null {
    if (this.#writer !== undefined) return null;
    try { this.#writer = this.start(); return null; } catch (error) { this.#writer = null; return error instanceof Error ? error.message : String(error); }
  }

  #write(line: string): void {
    this.ready();
    try { this.#writer?.(line); } catch { /* A watcher that died leaves the groups as they were before it. */ }
  }

  add(pid: number): void {
    // An exited leader's pid that a new spawn got back leads a group of ours again.
    if (!Number.isSafeInteger(pid) || pid <= 1 || this.#watched.get(pid) === true) return;
    this.#watched.set(pid, true);
    this.#write(`+ ${pid}\n`);
  }

  /** The leader exited: its group stays watched until it is empty. */
  leaderExited(pid: number): void {
    if (this.#watched.get(pid) !== true) return;
    this.#watched.set(pid, false);
    this.#write(`x ${pid}\n`);
    if (this.#poll === null) {
      this.#poll = setInterval(() => this.sweep(), this.pollMs);
      this.#poll.unref();
    }
  }

  /** Drops each group whose leader exited and that has no member left, or whose id a stranger now holds. */
  sweep(): void {
    for (const [pid, leading] of this.#watched) {
      if (!leading && (this.#stranger(pid) || !answers(this.signal, -pid))) this.remove(pid);
    }
    if (this.#poll !== null && ![...this.#watched.values()].includes(false)) { clearInterval(this.#poll); this.#poll = null; }
  }

  #stranger(pid: number): boolean { return this.#watched.get(pid) === false && answers(this.signal, pid); }

  /** SIGKILL to every watched group now, for an exit that cannot wait out the watcher's grace. */
  killAll(): void {
    for (const pid of this.#watched.keys()) {
      if (this.#stranger(pid)) continue;
      try { this.signal(-pid, 'SIGKILL'); } catch { /* Already empty. */ }
    }
  }

  /** Stops watching: the group is empty, or the keeper holds it for the next core. */
  remove(pid: number): void {
    if (!this.#watched.delete(pid)) return;
    this.#write(`- ${pid}\n`);
  }
}
