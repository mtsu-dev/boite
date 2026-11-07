# Keeper

A thread's terminal can outlive the core that opened it. With `BOITE_KEEPER=1`
on Linux or macOS, the core asks a small process, the keeper, to start each
thread shell. The keeper holds the PTY, so a restart, an update or a crash of
the core leaves the shell running, and the next core takes it back with what
it printed meanwhile. The setting is off by default.

The code is in `packages/core/src/keeper/`: `protocol.ts` (the wire),
`server.ts` (the keeper), `client.ts` (the core's side), `launch.ts` (how it
starts). `terminals.ts` uses it for thread shells only; a sign-in terminal and
an agent process still belong to the core.

## Processes

```mermaid
flowchart LR
  subgraph unit [boite.service or the desktop shell]
    core[core]
  end
  subgraph kunit [boite-keeper-<hash>-v1 unit, or its own session]
    keeper[keeper]
    sh1[thread shell]
    sh2[thread shell]
  end
  core -- "Unix socket, NDJSON, token" --> keeper
  keeper -- PTY --> sh1
  keeper -- PTY --> sh2
```

- The keeper is the core's own executable: `keeper/entry.ts` from the
  sources, `dist/main.js --keeper` from the bundle, `boite-core --keeper` from
  the compiled binary, which `compiled-main.ts` sends to the keeper before the
  core loads.
- Under a systemd user service whose main process is the core, the keeper
  starts in a transient unit, `boite-keeper-<hash>-v<protocol>`, with the
  core unit's `MemoryHigh`, `MemoryMax` and `CPUWeight`. A process that only
  left the core's session would still be in the core's cgroup, and
  `KillMode=mixed` kills that cgroup when the core stops. Anywhere else it
  starts in a session of its own and writes to `<dataDir>/logs/keeper.log`.
- One keeper per data directory and protocol. Its socket is
  `$XDG_RUNTIME_DIR/boite/keeper-<sha256(dataDir)[0:12]>-v1.sock` (0600, the
  directory 0700), since a data directory deep in a home can pass the 104 or
  108 bytes a socket path may have. A `flock` on `<socket>.lock` keeps a
  second keeper of the same directory from starting.
- A core says `hello` with the token in `<dataDir>/keeper.json` (0600). One
  core is attached at a time.

## What is kept, and where

| What | Where | Bound |
| --- | --- | --- |
| The PTY master and the shell | keeper | until the shell exits or is released |
| The shell's last output | keeper, per shell | 256 KiB (`KEEPER_PTY_HISTORY_BYTES`) |
| Output for a core that does not read | keeper, per connection | 16 MiB, then that connection is dropped |
| An exit no core collected | keeper | 10 min |
| What the shell is (id, thread, cwd, shell, argv) | keeper, as the tag the core gave | none, a few hundred bytes |

The core's own history of a shell is rebuilt from the keeper's 256 KiB when
it takes the shell back, masked as any output is.

## Restart

1. The stopping core lets go of its kept shells: they leave its registry with
   no exit recorded, and it closes the socket. The keeper keeps reading their
   output into the history.
2. The next core connects at startup without starting a keeper. For each shell
   the keeper holds whose thread exists and is not archived, it opens the
   session again, registers the pid, and sends `attach`. The keeper answers
   with the history as one `replay` frame, then live output in order.
3. Anything else it held is released: a shell of a thread gone since, one that
   exited while no core was attached, an older one under the same id.
4. `terminals.list` and `terminals.open` wait for that step, so a client that
   connects first sees the shell, not an empty tab.

A core holding no shell closes its connection. A keeper with no core and
nothing to hold exits after 60 s (`KEEPER_IDLE_MS`); the next shell starts
another.

## Stops

| Stop | Kept shells |
| --- | --- |
| Update (`/shutdown-for-update`, `/shutdown-if-idle`), `SIGTERM`, `SIGINT`, a crash | stay with the keeper |
| Desktop Quit (`POST /shutdown`), `core.shutdown` | end with the core |
| Closing the tab, archiving the thread | end, as before |

A keeper with live shells and no core for 10 min (`KEEPER_ORPHAN_MS`) ends
them and exits. `SIGTERM` to the keeper ends them at once.

When the keeper ends a shell (released, orphaned, or the keeper told to stop),
it first reads the shell's descendants and their process groups from `ps`,
then sends SIGHUP to each group and, 2 s later, SIGKILL to whatever of them is
left. A job an interactive shell put in a group of its own, `nohup` included,
goes with the shell. The keeper does not exit before that grace is over.

## Failure cases

- The connection closes while a core is attached, for instance because the
  core stopped reading for 16 MiB: the core connects again and attaches what
  the keeper still lists, asking only for the bytes after the last one it
  had (`attach.from`, the replay's `at`). More than the 256 KiB history
  missed leaves a gap before that history.
- The keeper dies: that reconnection finds no socket, and the core counts its
  shells as ended with no exit code; a core that was not attached finds
  nothing to restore.
- A thread archived or deleted while the keeper starts its shell: the shell is
  released as soon as it starts, and `terminals.open` refuses.
- A keeper of another protocol version: the socket name carries the version,
  so a core never reaches it. It ends its shells after its orphan delay.
- A wrong token or a second core: the keeper answers `refused` and closes.
- A frame without a line break past 64 MiB closes that connection.
- The keeper cannot start a shell: the core gets `failed` with the system's
  message, and `terminals.open` refuses with it.

## Limits

- Linux and macOS only. Windows keeps every process in the shell's job.
- Thread shells only. Agent sessions still stop with the core and resume
  through the [restart handoff](restart-handoff.md).
- A process the keeper started is killed by the core's tree kill on Linux and
  by a signal to its group on macOS, as any terminal.

## Measured

`bun bench/keeper-restart.ts 3` on boite-m1, 2026-11-07, Bun 1.4.2: three
core restarts of one thread shell that prints 64 KiB while no core is
attached.

| | Keeper off | `BOITE_KEEPER=1` |
| --- | --- | --- |
| Shell pid after each restart | a new shell (4 pids for 3 restarts) | the same pid |
| Output the next core had | 0 bytes | 65,713, 131,508, 197,303 bytes |
| Output printed while no core ran | lost | kept |
| `terminals.open` after a new `Core` | 14 to 16 ms | 15 to 17 ms |
| Keeper RSS holding one shell, from the sources | none | 32 MB |

The compiled binary's keeper, idle: 75 MB RSS, of which 52 MB are pages of
the binary itself, shared with the core in the page cache, and 22.5 MB its
own.

## Verification

`packages/core/test/keeper.test.ts` restarts a core on the same data directory
and checks that the thread shell keeps its pid, that the next core lists it,
has its earlier output and what it printed between the two cores, and that it
answers input; then that `POST /shutdown`'s stop ends the shell. The first
test fails on a core without the keeper: the shell is gone after the restart.
The same file checks that a core dropped while it did not read takes its
shell back with the end of 30 MB it missed, that ending a shell ends its
`nohup` job, and that archiving a thread while its shell starts ends it.
