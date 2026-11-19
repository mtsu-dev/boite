/**
 * Ties each agent process group to the core's life on Linux and macOS, as
 * `KILL_ON_JOB_CLOSE` does on Windows. Every child the registry spawns leads a
 * process group of its own (posix-kill.ts), so nothing the kernel does on the
 * core's death reaches it: a crash, a SIGKILL, the OOM killer or the shutdown
 * deadline left every agent and what it started running, unseen by the next core.
 *
 * One `sh` per core reads the groups to watch on a pipe from the core: `+pid`
 * when a group starts, `-pid` once its leader's exit is recorded or the keeper
 * takes it over. Only builtins run while the core lives. End of input means
 * the core is gone: the watcher sends SIGTERM to each group it still holds,
 * probes them every tenth of a second for two seconds as `stopGroup` does, then
 * sends SIGKILL to what is left, and exits. A graceful stop has emptied the
 * list by then, so the watcher exits at once.
 *
 * The watcher leads a session of its own and ignores the signals a terminal
 * sends, so a Ctrl+C that reaches the core's group does not end it first.
 */

/** The watcher's script; `$g` holds the pids, each between spaces. */
export const GROUP_WATCH_SCRIPT = `trap '' INT TERM HUP QUIT
g=' '
while read -r op pid; do
  case $op$pid in
    [+-]|[+-]*[!0-9]*) ;;
    +*) case $g in *" $pid "*) ;; *) g="$g$pid " ;; esac ;;
    -*) case $g in *" $pid "*) g="\${g%% $pid *} \${g#* $pid }" ;; esac ;;
  esac
done
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

/** Where the lines go; null when no watcher could start, which leaves groups as they were. */
export type WatchWriter = (line: string) => void;

function startWatcher(): WatchWriter | null {
  const shell = Bun.which('sh');
  if (shell === null) return null;
  const watcher = Bun.spawn({ cmd: [shell, '-c', GROUP_WATCH_SCRIPT], stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', detached: true });
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

export class GroupWatch {
  #writer: WatchWriter | null | undefined;
  readonly #watched = new Set<number>();

  /** `start` runs once, at the first group: no process at core startup. */
  constructor(private readonly start: () => WatchWriter | null = startWatcher) {}

  #write(line: string): void {
    if (this.#writer === undefined) {
      try { this.#writer = this.start(); } catch { this.#writer = null; }
    }
    try { this.#writer?.(line); } catch { /* A watcher that died leaves the groups as they were before it. */ }
  }

  add(pid: number): void {
    if (!Number.isSafeInteger(pid) || pid <= 1 || this.#watched.has(pid)) return;
    this.#watched.add(pid);
    this.#write(`+ ${pid}\n`);
  }

  /** SIGKILL to every watched group now, for an exit that cannot wait out the watcher's grace. */
  killAll(): void {
    for (const pid of this.#watched) {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* Already empty. */ }
    }
  }

  remove(pid: number): void {
    if (!this.#watched.delete(pid)) return;
    this.#write(`- ${pid}\n`);
  }
}
