# Trace, caps and guards

Every agent process starts through one registry. Windows records Job Object
tree events; Linux and macOS expose more limited tracking. The trace reports
observed processes and resources, with unknown values left unknown.

A running turn's footer shows its last observed activity: startup, thinking,
compaction, retry, tool work or provider wait. Its timestamp advances on an
event, not a timer. After a minute without execution activity it offers Trace;
silence does not establish that a provider is stuck. Reconnect restores the
snapshot and completion clears it. Provider signals have a separate timestamp,
so repeated status notifications do not imply execution progress.

Codex reasoning boundaries count as activity without reading encrypted content
or inventing thinking text. Completed public messages render immediately and
update the native item already shown; reconnect does not duplicate them.

## Platform boundary

The registry calls `ProcessPlatform` in `packages/core/src/platform/types.ts`.
`platform/index.ts` selects `platform/windows/` or the shared Linux/macOS
`platform/posix.ts` backend. Windows owns Job Objects, FFI, workers, guards and
native fallback termination. Drivers and RPC handlers use the registry rather
than importing OS backends. Unsupported protections remain off even if saved
settings enable them.

The registry owns spawn, exit, journal process rows and thread events. A process
row is written whole at start; the exit updates its exit columns only, without
copying it into the operational event journal. On a full disk a row is skipped
instead of stopping the core: the process runs untraced, and a `trace.disk-full`
warning is logged at most once a minute (`trace-writes.ts`). A thread keeps its newest 2,000
rows, every live row and the rows a process agent card reads (the agent CLI and
its parent, `native-agents.ts`). Older rows are deleted when a finished turn's
sweep runs, when the registry forgets an idle thread, and every 500 exits of a
thread that never goes idle (`journal/processes.ts`). The background passes of
the journal also cut, one thread at a time and again daily, every thread holding
more than 500 rows past what it keeps, idle or not, so a thread that never runs
again does not keep its whole trace; a thread between 2,001 and 2,500 rows is
left to the sweeps above. A row names its command line through
`command_lines`, which holds each distinct line of a thread once and loses
those lines with the rows that named them or with the thread. The rest stays until
thread/project removal. Synthetic operations without a real thread lose their
rows when the registry forgets them, 30 seconds after the last process exits.

The shell has a separate native boundary under
`apps/shell/src-tauri/src/platform/` for core ownership, launch flags, data paths,
toasts and appbar queries. Shared IPC commands still check their callers.

## One launcher, one Job Object per thread

`procs.spawn`, `procs.spawnChild` and `procs.spawnPiped` in
`packages/core/src/procs.ts` own process creation. Bypassing them loses registry
tracking and protections.

A bare command name (`git`, `gh`) is resolved to an absolute path through the
remembered PATH lookup, with the child's own PATH, so Bun and node do not walk
PATH and PATHEXT again on each spawn (`spawn-command.ts`). A Windows `.cmd`,
`.bat` or `.ps1` shim and a name PATH does not find are passed on unchanged.
Git is resolved first by `launchOf` (`git/command.ts`), which on Windows
already swaps Git for Windows' launcher for its real binary; this lookup leaves
that absolute path alone. A resolved path that is gone
(ENOENT) forgets the lookups: `spawn` and `spawnPiped` start the bare name once,
`spawnChild` reports the error and its next spawn looks again. The trace row
keeps the name the caller gave.

Windows creates an unnamed per-thread Job Object nested in an unnamed global
job. Both use `KILL_ON_JOB_CLOSE`, with no `BREAKAWAY_OK`. Children are assigned
immediately after spawn and use `windowsHide: true`. Closing the core's jobs
ends their member processes. An empty thread job is forgotten after 30 seconds;
a job that still reports members remains held. A pid that could not join its
job, or any pid of a thread with no job, is stopped by `taskkill /T /F` started
asynchronously with a five-second deadline. The child's own kill runs once
taskkill ends, since `/T` needs the root alive to find the tree, and
`killAll` at shutdown waits for both. Taskkill gets only a pid the core
spawned and has not seen exit, held as described under managed stops below; a
process the core did not spawn or saw exit gets only its own kill.

Independent cores in one process share the native drain, with an opaque job
scope per registry and thread. Starts, exits, guards and controls use that same
scope. Equal public thread IDs in different cores stay independent; closing a
registry removes only its routes, jobs and guarded PIDs. A restarted registry
gets fresh scopes, so delayed events cannot attach to its replacement.

Codex initialization can temporarily use normal priority for at most 30 seconds.
The driver restores below-normal priority on ready, failure or Stop; the registry
also restores it on exit or deadline. A refused downgrade retries every 250 ms.
Warm sessions get no new boost. CPU and memory caps apply throughout. Failed
global assignment or cap application, or a disabled/full CPU cap, withholds the
boost. Other threads and POSIX scheduling retain their existing behavior.

A completion-port Worker reads tree membership events, grandchildren included.
It starts on a turn or the first traced PID and sleeps until a packet arrives.
After 30 seconds with no occupied jobs it stops; the port remains open for the
next Worker. Process handles are opened when packets arrive. Each process also
belongs to the global job on the same port; the Worker drops that job's copy of
every start and exit and posts only its memory budget alert. A process that
already exited may have no readable identity and stay outside the trace while
its CPU remains in job totals. Console hosts are similarly excluded from trace
rows and load while remaining in totals, known by their image name or, when
that read fails on a host caught as it starts, by a command line that starts
the system's own `conhost.exe`. Terminating a job requires explicit
exit reconciliation because the port may report only the empty-job event.
A job nested inside a thread's job, such as the one a test suite's own core
gives the CLIs it starts, posts no exit to the thread's job when it is
terminated. Each load sample therefore reads the exit code of every tracked
handle, and a process that has exited is reported as it would be from its
exit packet. A packet that arrives later matches no live record.

After root-exit telemetry settles, protected tools wait up to five seconds for
every thread of their captured capability to drain. Native membership can retain
a console after its exit notification. Each pass queries the held job and checks
the live registry; an empty job reconciles captured exits through the normal
handle and creation-identity checks, without waiting for completion-port delivery.
The final synchronous publication gate still refuses an occupied or unreadable
job at the deadline. Root telemetry has its own five-second budget. Replacing or
revoking the captured capability interrupts publication; an old tool cannot
publish through or revoke the replacement preparing on the same thread.

For a native ordering investigation, `BOITE_DIAGNOSE_JOB_EVENTS=1` writes
`WINDOWS_JOB_EVENT` records to host stderr: worker packet/action/sequence,
main-thread receipt, captured creation identity and registry admission or
rejection. Protection records identify the captured capability, native and
registry membership, refusal phase, revocation and process-stop requests. Probe
records distinguish deadline termination from a completed command. The native
protected-tools and provider/shared CI steps enable it for both helpers.
Publication snapshots include the PID list from that same native membership
query and the existing captured and ignored PID sets, without reopening a PID.
It records no commands, environment or paths and changes no exit, wait or
publication decision. A later PID lookup without a valid creation time cannot
identify the incarnation retained by the registry.

`process.started` and `process.exited` carry the available PID, parent PID,
executable, command line, timestamps, exit code, CPU time, peak memory and I/O.
The UI applies them only while the trace surface is on screen, which reads
`trace.get` when it appears, and keeps the newest `TRACE_LIMIT` (200) rows,
as many as `trace.get` returns without a `limit`.

## What a client sees

| Method or field | Meaning |
| --- | --- |
| `trace.get` | One thread's recorded processes, newest first |
| `resources.list` | Threads with live processes, their last sampled `ThreadLoad`, busiest first |
| `resources.usage` | Agent identity and cached CPU, memory, storage and TCP readings, without process arguments or paths |
| `resources.machine` | The machine's own CPU, memory, GPUs and fixed disks, and on Windows each agent's GPU share; model names, sizes and loads, no path beyond a drive letter or mount point |
| `resources.killTree` | Stops the registered thread tree or groups; wait for live count zero before treating exits as observed |
| `ThreadLoad` | Sampled process count, CPU percentage and memory on each thread summary |
| `thread.load` | A thread's new `ThreadLoad` alone, sent to a connection whose `hello` `accepts` it; any other connection gets the whole row as `thread.updated` |

The load tick samples every live scope once a second while a turn runs, a
`resources.usage` lease is held, memory is under pressure, a startup boost is
pending or the previous tick saw a thread at 2% CPU or more or a changed process
count. Otherwise it waits four seconds. A `turn.started` or a new lease brings
the next tick forward to one second. A tick with no live process and memory
`ok` reads nothing. A load is sent when it moved by more than 1% CPU, 1 MiB or a
process; a scope with no thread behind it (a terminal, the devices) asks the
thread table again only then. A thread whose processes never all exit forgets
each exited pid 30 seconds after its exit, so late job events are still
recognized while its history stays bounded.

Manual archive also cancels temporary side questions throughout the retained
family. Their retired requests cannot publish answers after restoration.

Manual archive stops the thread's turns and those of its child threads, then
ends their registered processes once the stopped turns settle. Exited
processes remain in `trace.get`. An archived thread appears in `resources.list`
only while it has live processes, including ones explicitly started after
archive cleanup.

Protection settings refresh resources every two seconds while visible. Trace
lists active processes first, then recent starts. Expand a row for command,
path, IDs, CPU and I/O. Its capability disclosure identifies incomplete tracking.
A command line belongs in this authorized trace view, not diagnostic logs.

## Agent task manager

Settings > Task manager opens with one card per connected machine: CPU and
GPU over the last minute, memory with the share Boite's agents hold, and the
free space of each fixed disk, red under 10%. Picking a card lists that
machine's live processes grouped by agent, with search and sorting by memory,
CPU, GPU, disk or network activity. Desktop owners
can stop an agent's processes after confirming. Paired phones can read the same
measurements and open the owning conversation, but cannot stop processes.

The view asks for cached measurements every two seconds while visible.
`resources.usage { watch: true }` holds a six-second lease owned by its connection;
closing, hiding or disconnecting releases that connection's lease. Detailed
collection stops when no lease remains. A request without `watch` reads the
snapshot without enabling collection. Unsupported cores show an update message
and wait for an explicit retry.

CPU is a percentage of the machine's logical processors; memory is the current
platform sample, not lifetime allocation. A missing measurement displays
"Not available". Totals disclose when only some agents have readable counters.
Linux sampling separates independently registered nested agents, so their
subtrees do not contribute to both rows.

Linux disk activity uses task-local procfs storage counters, excluding character
I/O and a parent's accumulated counters from reaped children. TCP activity joins
kernel payload counters to an agent's currently held socket descriptors,
checking process birth, network namespace and socket identity. Shared sockets
between separately registered agents remain unattributed. Download/upload rates
and byte totals cover observed intervals while collection is active, not the
agent's entire lifetime. Short processes or connections can escape observation;
UDP traffic and protocol overhead are outside these TCP counters. Disk activity
does not describe folder size.
A failed TCP dump displays unavailable; a later valid reading can recover the
actual byte delta only when the socket and process identities still match.

Each card asks its own machine's core for `resources.machine` every two
seconds while visible. Callers within a second share one reading, and the
first reading waits 200 ms so CPU has an interval to measure. A core that
predates the method says so on its card and is not asked again.

| Platform | CPU and memory | GPU | Disks |
| --- | --- | --- | --- |
| Windows | `os.cpus()` deltas, `GlobalMemoryStatusEx` | DXGI adapters, PDH `GPU Engine` and `GPU Adapter Memory`; the busiest engine, summed over its processes as Task Manager counts it; per-agent share from the pid in each instance | Fixed drives from `GetLogicalDrives` |
| Linux | `os.cpus()` deltas, `/proc/meminfo` | `nvidia-smi` with a 2 s timeout, then amdgpu sysfs; other DRM cards listed without a load | Disk filesystems in `/proc/self/mounts`, one row per device at its shortest mount point, `/boot` and snaps left out |
| macOS | `os.cpus()` deltas, total memory only | Not measured: IOKit statistics are private API | `/` and `/Volumes` |

The PDH query opens on the first GPU read and closes after 30 seconds without
one. A GPU reader that fails marks the GPU "not measured" and the rest of the
reading still arrives.

Windows supplies job CPU and memory measurements. macOS supplies readable
physical footprint measurements, with CPU unavailable. Storage and network
activity on unsupported platforms display unavailable rather than zero.

## Structured diagnostics

Diagnostics are written apart from SQLite events, one JSON record per line,
under `<dataDir>/logs/`:

| Files | Writer | Rotation |
| --- | --- | --- |
| `core.0.ndjson` to `core.7.ndjson` | the core (`packages/core/src/logs.ts`), plus `origin: "ui"` records clients send | 2 MiB per file |
| `shell.0.ndjson` to `shell.3.ndjson` | the desktop shell (`apps/shell/src-tauri/src/shell_log.rs`) | 1 MiB per file |
| `exports/boite-diagnostics-*.txt` | an export | the newest 10 |

Every record carries `id`, `runId` (one per process start), `at`, a level
(`debug`, `info`, `warn`, `error`), `origin` (`core`, `shell` or `ui`; absent
on older records, which are the core's), `source`, a dotted `event` and a
readable `message`. Optional fields correlate it: `threadId`, `turnId`,
`requestId`, `durationMs`, and `data`, at most 16 scalar values. A record
about a thread also names its agent, `providerId`, `model` and
`parentThreadId`, resolved when it is written, so a delegated child reads as
`[thr_child claude/claude-opus-5-5 <thr_parent]` on every line. Turn records
carry the queue wait, the duration, the token counts and the effort; process
records the program's file name, pid, exit code, CPU time and peak memory.
A start waits up to 2 seconds for its exit before it is written. A process
that exits cleanly within that time gets no record of its own: its turn's
`process.batch` record, written every 10 seconds, counts those processes by
program with their CPU time (`3 short processes ran: bash.exe 2, sed.exe 1`).
A crash (a signal or a Windows status code) and an exit whose status the OS
did not give keep both records. On 2026-10-17, with about 20 agents at work,
the eight core files held 32,749 process records over 368 seconds, 89 a second
and 2.45 MB a minute. `bun bench/process-log-replay.ts <logs directory>` plays
them through this store, which writes 1,013 records, 2.8 a second and 0.06 MB
a minute.

The sink redacts configured credentials and recognized sensitive fields before
bounding messages to 4,096 characters, metadata to 200 and `data` strings to
300. It accepts explicit diagnostic metadata, not RPC payloads or process
arguments. Raw provider output classified as `kind: 'provider-output'` stays
visible in the owner's live log, including usable login links, with
configured credentials removed and the same 4,096-character limit. Paired
devices and agents do not receive that log event. Persistence and diagnostic
queries replace it with `[provider output omitted]`. A turn's own error text
can carry provider output, so `turn.finished` records only the status; the
cause is in the `turn.failed` record built from the driver's diagnostic.
Producers must classify output; text redaction alone is not a transcript
filter.

Writes use a bounded 1,024-record pending buffer and 250 ms batching, with
earlier flushes for large batches. Memory holds only the records the files do
not: pending ones, the batch being written, and up to 4,096 that will not be
written (a failed sink, an overflow of the pending buffer, a record larger than
a file). Overflow reports dropped persistence. A failed sink reports once and
leaves core work running. Queries merge that memory, the core files newest
first (stopping once an older file cannot change the answer) and the shell's
files, ignore malformed or partial crash records, sort by time and serialize
reads with rotation. A query with `since`, such as the Diagnostics page's poll
every 3 s, opens no file last modified more than 10 minutes (the allowed client
clock skew) before it. Close flushes writes. POSIX directories use `0700` and
files `0600`.

### Anonymization

Local files keep redacted text. What leaves the owner, an export, an issue or
an agent's read, also goes through `createLogAnonymizer` in
`@boite/contracts`. Project paths and names become `<project:xxxxxx>`, worktree
and thread folders outside a project too; the data directory `<data>`, the
home `~`, other accounts' homes `<user>`, the account name `<user>`, the host
name `<host>`, account labels `<private:xxxxxx>`, e-mail addresses `<email>`,
non-loopback IPv4, IPv6 and MAC addresses `<ip>`, `<ip6>` and `<mac>`. A URL
keeps its host and path only for public services (provider APIs, GitHub,
package registries); any other host becomes `<host:xxxxxx>/<path>`, and a
GitHub owner and repository other than Boite's own `<owner:xxxxxx>` and
`<repo:xxxxxx>`. `xxxxxx` is a hash
salted with `<dataDir>/logs/anonymize.salt`, so one machine's exports agree
with each other and differ from another machine's. Thread, turn and run ids,
versions, times and loopback addresses stay readable. A path is replaced
whatever the name; a bare name is replaced only when it is not an everyday word
of the logs (`server`, `demo`, `admin`, `app` and the rest of `COMMON_WORDS`),
because replacing such a word everywhere would erase the logs' own vocabulary.
A project named `demo` keeps that word in free text.

### Reading them

`core.logs { limit?, threadId?, turnId?, level?, minLevel?, origin?, source?, since?, until?, search?, anonymize? }`
is owner-only because redacted causes can still describe paths or other
conversations. It returns newest first, defaults to 100 and accepts 1 to 1000
records. Invalid fields, filters and levels are refused.

`diagnostics.logs`, `diagnostics.summary`, `diagnostics.export` and
`diagnostics.issue` return the anonymized view. The owner calls them freely;
an agent names its own thread and is refused while the `agentLogAccess`
setting is off (Settings > Diagnostics). An agent is held to its own thread,
like every agent call: it reads the records about no thread (the core, the
shell, the clients), which say whether Boite itself failed, plus those of its
thread and of every thread it started, never another conversation's. With
`scope: 'thread'` it leaves the records about no thread out. The owner reads
everything, or one thread's family with `scope: 'thread'`.
`diagnostics.summary` groups warnings and errors by origin, source, event and
level, and lists each thread in reach that the window touched with its agent,
status, parent, project placeholder and error count. An agent's export covers
the same reach and leaves out the raw `core-output.log` and `shell-error.log`
tails, which can name any conversation.

`diagnostics.export` writes one text file a developer reads top to bottom:
environment (version, channel, OS build, CPUs, memory, uptime, trace mode),
agents and their versions, behaviour settings without addresses or paths,
grouped problems, threads, log file sizes, the ends of `core-output.log` and
`shell-error.log`, then the timeline oldest first, one `formatLogLine` per
record. It covers the last 24 hours by default, at most 20,000 records.

`diagnostics.issue` drafts a GitHub issue for `mtsu-dev/boite`: the user's
description, the environment, the problems and as many of the newest log lines
as fit. With `submit: true` it runs `gh issue create` under the core's own
`gh` login and returns the issue URL; without a signed-in `gh` it returns a
prefilled `issues/new` link the user opens in a browser signed in to GitHub.
Either way the saved export path is returned so the full file can be attached.
Only the owner's `submit: true` runs `gh`: an agent's returns the draft, the
link and an error saying the user publishes it, because the issue is public and
signed by the owner's GitHub login.

A reported `threadId` is kept only when that thread exists.

`diagnostics.report` takes up to 50 records from a client, owner or paired
device, stored with `origin: "ui"`, the client kind and whether it is remote.
A connection may send 300 a minute; the rest of that minute is dropped with one
warning. A client time more than 10 minutes off is replaced by the core's.

[CLI](cli.md#diagnostics) documents `boite logs` and `boite issue`, and the
built-in `boite-report-issue` skill agents receive ([brain](brain.md#boite-guide)).

## Caps

Windows applies `agentCpuCapPercent` to the global job and
`threadMemoryCapMb` to each thread job, including existing jobs. A configured
zero disables those explicit caps. A tree at its allocation cap can fail its
next allocation. The automatic memory guard is separate and also runs on POSIX.

Settings > Protection > Limits controls `memoryProtection`, quotas and reserve.
Turning protection off removes automatic memory stops and Windows allocation
caps immediately while retaining configured values. Zero quota or reserve means
automatic sizing, not disabled protection. Resource readings remain visible;
the OS can still refuse allocations.

The automatic reserve is the larger of 10% of physical RAM and 3072 MB.
On machines with less than 12288 MB of RAM, it uses 25% instead, so the
desktop and a small agent can run without permanently tripping the guard.
An explicit reserve keeps its configured value.

Below the reserve alone, the guard stops a process only in the heaviest
thread, and only when that thread's stoppable processes (all but the agent's
root) hold at least an eighth of the reserve, capped at 256 MB. Otherwise other
programs hold the memory: stopping a small helper, such as the process an agent
starts for its sign-in, would break the agent and free nothing. The pressure
state still reads critical. Thread quotas and the agent budget have no floor.

Memory stops appear beside the interrupted tool. Persisted message/part
boundaries keep later output from relocating the notice. Repeated notices at
the same boundary, reason and threshold share a folded process list. Owners can
open the owning machine's memory settings, including from phone-width Settings.
Paired devices cannot change core protections. The last stop of a machine
(`Workbench.memoryStop`) stays in the notification corner (`MemoryCorner`), on
any page, until its card is closed or its Memory settings button used: the open
thread's own card carries it when that thread's history can, otherwise the
machine's card does.

## Orphans

Windows can retain processes after the shell that launched them exits. Ten
seconds after a turn or an agent release, with no intervening turn, the registry
checks traced processes at least ten seconds old. A missing parent, or a parent
whose start time is newer than the child because its PID was reused, identifies
an orphan. Before stopping it, the platform checks whether the untracked parent
still runs and was created before the child; a live original parent keeps its
child. Termination uses the original held process handle and its descendants,
not a newly opened PID. Each action emits a thread-correlated diagnostic.

Git Bash (MSYS2) forks a copy of the shell to exec each command, and the copy
exits as soon as the command runs, so a script's Windows parent is gone while
its shell still runs. Each traced process keeps a reference to its parent's
last entry at its start, even an exited one: a start can wait for its command
line while the fork exits, and the job reports a parent's waiting start before
its child's. An exited `sh`, `bash`, `dash` or `zsh` that
exited with 0, whose own parent has its image and still runs, is such a fork:
the process hangs from that live shell and stays while it runs, so `sh wait.sh`
in a background task lives as long as its shell. Of 74,975 forks in a real
trace, all exited with 0. No timing is read, since exit events can arrive late.
A fork can also exit before the core handles its start, and Windows no longer
gives the full path of an exited process: an exited child of a live shell with
no image name and exit code 0 counts as a fork too.
One exited fork is passed over, never two: the `sleep` of a nested bash that
exited or was stopped has the fork and that bash dead above it, and goes. Once
the task's shell exits, the script is an orphan again and its own forked
children go with it. A shell is a different image from the agent above it, so
what an interrupted command leaves still qualifies, and any other exited parent
of the same image, a Node worker under Node say, leaves an orphan.

Processes directly launched by the core and children of live shells remain.
Detached descendants and launcher children can qualify even when intentionally
left running; `reapOrphans` controls that policy. Release paths include archive,
Stop, account/provider changes, child cleanup and resident-agent checkpoints.
The sweep is linear in live processes. POSIX tracks direct core children only,
so orphan reaping finds no additional descendants there, and Resources greys
the `reapOrphans` switch out off Windows (`ResourcesPage.svelte`).

## The focus guard

A Windows Worker installs `SetWinEventHook` for foreground changes and runs the
required message pump. The registry supplies traced PIDs and settings. When a
traced window gains focus, the guard sends it to `HWND_BOTTOM` without activation,
then attempts to restore the prior window through `AttachThreadInput` and
`SetForegroundWindow`. `process.focusPushed` records the thread, PID, title and
restore outcome. Job Object UI limits are not used; they do not prevent window
creation or foreground activation and can interfere with nesting.

The shared guard/audio Worker starts with a turn or traced process, stops after
30 seconds without a traced PID, and stops after both protections remain off for
30 seconds. A turn resets the grace. Both off means no Worker starts. Startup
failures log once per core run; a refused focus hook can leave audio protection
running and exposes its failure through `guardStatus()`.

The pump waits on its message queue 100 ms at a time, less when a batched audio
walk is due sooner.

Tests use fake Win32 calls.

## The audio mute

The same Windows Worker initializes COM and walks the sessions of the default
render endpoint after a new PID and whenever Core Audio reports a change: the
first walk of an endpoint registers `IAudioSessionNotification` on its session
manager and `IMMNotificationClient` on the device enumerator, so a session that
opens, a device that comes or goes and a new default device each start a walk.
Both objects are vtables built in `audio-sessions.ts`; their only JavaScript is
one thread-safe `JSCallback` that answers S_OK on Core Audio's thread and runs
on the Worker's. `IUnknown` and property changes are a few bytes of x64 or
arm64 code in a page made executable once: QueryInterface writes null and
answers E_NOINTERFACE, AddRef and Release answer 1. A PID or a notice that comes less than 100 ms after the last walk
waits for one shared walk at the end of those 100 ms, so a build that starts
hundreds of processes walks at most ten times a second.

Turning the mute back on walks at once, for a session that opened while it was
off and sent its only notice then. Core Audio reports no mute change, so the Worker still walks once a second
while a traced process has a session (an agent that unmutes itself, or a
session that opened muted from Windows' remembered state, is muted again within
a second), and when the endpoint refused the registrations, which is one
`session-skipped` note. Otherwise the clock is a walk every 30 seconds, for a
notice that never came. One walk costs 0.6 to 1.5 ms of CPU with 5 to 7
sessions and 1.9 to 2.3 ms with 20 to 22, plus 3 to 15 ms of round trips to the
audio service (2026-10-17, a Windows 11 desktop, `bun bench/audio-walk.ts 0`
and `bun bench/audio-walk.ts 15`, whose extra sessions are the silent-tone
fixture). Over 60 seconds with one traced PID that plays nothing, the Worker
process used 156, 172 and 141 ms of CPU with the one-second walk and 62, 109
and 203 ms with notices, against 78, 94 and 188 ms tracing nothing (same day,
`bun bench/guard-cpu.ts 60`, then `nopid`, alternated three times; Windows
counts CPU in 15.6 ms steps and the third round ran beside other work): the
Worker now walks about twice a minute instead of sixty times. It mutes unmuted
sessions belonging to
traced processes and holds their volume interfaces. Unreadable sessions are
reported once; a failed or changed endpoint is reopened and registered again.
With no endpoint it retries every 30 seconds. A COM startup refusal disables
this half for that Worker's lifetime.

On process exit, setting disable or Worker shutdown, it restores only mutes it
applied and releases interfaces. User-muted sessions remain muted. Core shutdown
waits up to one second for release (two when the wake failed and the pump may
be in a one-second wait) so Windows' persistent session mute does not
carry into a later launch. `process.muted` identifies the thread and PID.
Logic tests use a fake endpoint; the native audio test opens a session with two
seconds of zeroed PCM, without audible content, once at start and once four
seconds late, which only Core Audio's notice can catch inside the test's window.
Run inside a Boite thread whose machine mutes agents, the fixture is muted
again within a second of an unmute that Core Audio took and that reads
unmuted: the tests that need the test core to mute it are skipped then, with
that reason, as on a machine with no audio device. A mute an earlier run left
behind, or an unmute that failed, is no such machine, and the tests run.

## Keeping the machine awake

While a turn runs or waits for a scheduler slot, the core holds the sleep
inhibitor of the machine it runs on (`keep-awake.ts`,
`ProcessPlatform.keepAwake`), so a long task is not cut by the machine going
to sleep. It is the core's, not the window's: it holds with the app closed and
on a headless server. A thread in `waiting`, an approval or a question card
open for the user, holds nothing. The hold is given back 5 seconds after the
last working thread rests, at once when `keepAwake` goes off, and when the
core closes.

| OS | Inhibitor | Ends with a dead core because |
| --- | --- | --- |
| Linux | `systemd-inhibit --what=sleep:idle --mode=block cat`; `--what=idle` alone when logind refuses to block sleep, as it does for a service with no active session | `cat` reads a pipe the core holds |
| macOS | `caffeinate -i cat` | the same pipe |
| Windows | `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)` | the state belongs to the process |

None of them stops a sleep the user orders, a closed lid or the screen
turning off. A machine without the helper, or one that refuses it, logs
`keepAwake.unavailable` once and is not asked again until the setting changes.
`resources.keepAwake` answers `{ held, available }`: `available` is false when
the platform has no helper (`keepAwakeAvailable`, asked before any turn), when
the hold was refused or lost, and under `BOITE_KEEP_AWAKE=0`. Settings,
Resources reads it with each poll and says so under the Keep awake switch.
`BOITE_KEEP_AWAKE=0` makes a core hold nothing; the test preload sets it.
`keep-awake.test.ts` drives the rule with a counted hold and the helper with a
stand-in command, and lists the real logind inhibitor where a system bus
exists.

## Turning them off

| Setting | Effect when off |
| --- | --- |
| `memoryProtection` | Removes automatic stops, Windows allocation caps and the Linux throttling notice |
| `focusGuard` | Leaves agent windows' foreground behavior unchanged |
| `muteAgents` | Restores agent sessions muted by Boite |
| `reapOrphans` | Retains leftovers until tree termination or core exit |
| `keepAwake` | Gives the sleep inhibitor back; the machine sleeps by its own power settings |

Protections are on by default. Notifications are a separate client preference
under General, stored per device as `boite.notifications`: one switch every
connected machine's Store reads. When the shell finds no way to show a toast,
the switch goes off and the view on screen says so, whichever machine tried. The desktop shell's
`notify` command shows a Windows toast, or runs `notify-send` or `osascript` on
Linux and macOS ([portability](portability.md)); phones use Web Notifications.
A click opens the thread, except on Linux and macOS.

## Linux and macOS

No Job Objects exist. Spawn/exit records cover registered direct children,
without grandchild events. Bun provides exit usage for its subprocesses; the
Node path supplies no POSIX exit usage. `TraceCapability.mode: 'poll'` names
this fallback, not complete process-tree event tracking.

Linux samples procfs on each load tick for registered processes and their descendants.
Descendants come from each task's `/proc/<pid>/task/<tid>/children`, read on
every tick. Those files can leave a live child out, so `/proc` is still listed
at the old 500 ms pace, but only a pid new to the listing has its stat line
read; every stat line is read again each 5 s. A descendant only the listing
names counts only while its own stat line names a process already counted.
Without those files, a scan of every stat line answers alone, reused for 500 ms.
A stop by pid still scans the whole machine beside the children files before
it signals anything.
CPU uses `/proc/<pid>/stat`; memory uses `RssAnon + RssShmem`, falling back to
`VmRSS` on older kernels. The latter includes shared library mappings and can
overcount a parallel workload. A process name is read from `/proc/<pid>/comm`
once per birth and again only when the stat line's name changes, as after an
`exec`; the boot time from `/proc/stat` is read once. macOS walks descendants with
`proc_listchildpids` and sums `proc_pid_rusage` physical footprint for registered
roots and their descendants, once per PID. A separately registered conversation
owns its subtree. CPU still reports zero, with `cpuMeasured: false`:
`resources.list` and `resources.usage` carry it as `loadAvailable.cpu`, and
Resources, the Task manager and the Trace surface print Not available. The automatic memory guard can
stop the heaviest child tree when a thread exceeds its share. CPU job caps,
focus guard and audio mute remain Windows-only; Settings and the tour grey
their controls out when `core.os` is not `windows`.

A Linux memory stop of a child the core spawned goes through the handle it
holds, which signals nothing once the child has exited; a child is not reaped,
so its pid is not reused, before that handle sees the exit. Any other Linux
orphan or memory stop goes by pid: procfs birth ticks must match the
registered process or the last sampled descendant. An orphan stop also checks
the registry's captured start time. Each tree member is checked again before
its signal; a missing or changed birth is skipped. These procfs checks and
PID signals are separate operations, rather than a held native process handle.

A macOS memory stop also accepts an unregistered sampled descendant. A fresh
walk must place it under the conversation's unchanged registered roots, and
`proc_pidinfo` BSD start seconds and microseconds must match its registered or
sampled birth. Each member's birth is checked again before SIGKILL, with children
stopped before parents. Unreadable identities, reused PIDs and other conversations'
subtrees are skipped. These identity checks and signals are separate operations;
they do not provide Windows' held-handle guarantee or track detached orphans
after reparenting out of the registered tree.

Linux also reads the cgroup of each thread's root agent process on the same
sample: the `0::<path>` line of `/proc/<pid>/cgroup`, then
`memory.events`, `memory.pressure`, `memory.high`, `memory.max` and
`memory.current` under `/sys/fs/cgroup<path>`. The path, `memory.high` and
`memory.max` are kept per process for 30 seconds, so a limit an admin changes
lands within that; a tick reads the three counters. Past `memory.high` the kernel
fails nothing; every process of the group stalls near 0% CPU while the `high`
count of `memory.events` climbs. That count alone proves no stall: a group
whose charge is mostly clean page cache reaches the limit during any large
build, the kernel drops cache and no process waits. A sample therefore counts
as stalled only when the `high` count rose and the `some` total of
`memory.pressure` grew by at least 20% of the time since the previous sample
(200 ms per second). A thread with five stalled samples gets one `throttled`
memory notice naming the limit, delivered to the user and the agent like a
memory stop, then at most one every five minutes while the stall continues;
its event also carries the group's current charge. Thirty seconds without a
stalled sample end the streak. A root process found in another cgroup path, or
any counter lower than the last one, starts over as a new group: five new
stalled samples are needed before the thread gets another notice. Two samples
more than five seconds apart only restart the measure: no stall share is
computed over an idle gap.
A reading needs `/proc/<pid>/cgroup`, `memory.events`, `memory.pressure`,
`memory.high` and `memory.current`: when any of them is missing, unreadable or
malformed there is no reading and no notice. That covers cgroup v1, a group
without `memory.high`, a kernel without `memory.pressure` and a path outside
the core's cgroup namespace. `memory.max` is read when present and never
required. The notice follows `memoryProtection` and stops nothing.

Registered POSIX children start detached in their own process group.
`resources.killTree` captures each live root's current descendants, including
processes in separate sessions. It sends SIGTERM to the group and captured
processes, probes every 100 ms, and sends SIGKILL to survivors after two seconds.
The group and the captured births remain usable after the leader exits. A
descendant that reparented before the capture is reachable only through the
group or another registered root. Each spawn also returns a `stop` bound to
that spawn. It resolves once its subtree stop and the process exit finish.
A short system command
(`tailscale`, the firewall, device SDK tools) runs through `runCommand`
(`packages/core/src/run-command.ts`): at its deadline it is stopped that way
and its pipes are given half a second to close, so a helper holding them
cannot hold the caller. On Windows a managed stop on a live, assigned root
reads the job's current membership and opens handles for the root and its
descendants. It verifies their membership and births, then stops children
before parents. Other members of the same job keep running. For an unassigned
root the backend opens its own handle in the tick the spawner saw it live and
holds it until `taskkill /T` ends, retaining the PID while taskkill runs.
Normal shutdown waits for escalation. A hard shell kill can cut it short on
Linux and macOS.

A core that dies without stopping its agents takes their groups with it on
Linux and macOS too (`platform/posix-group-watch.ts`). One `sh` per core
process, started before the first spawn, reads the groups on a pipe from the
core. A group is added right after its spawn, before anything else is read
about it. Its leader's exit marks it, and it is removed once a probe every
second finds it empty, or at once when the keeper takes it over: tools a
leader left behind stay held. A group id is its leader's pid, which the
kernel does not reuse while the group has a member, so a live process with
that pid means the group emptied: it is dropped and never signalled. After the
core, the watcher signals such a group only when the probe of that pid says
"No such process"; a refused probe counts as a live stranger. A new spawn that
gets the pid back is watched again as a running group. When the
pipe closes, after a crash, SIGKILL, the OOM killer or any exit, the watcher
sends each group it still holds SIGTERM, probes them every 100 ms and sends
SIGKILL to what remains after two seconds. A shutdown past its deadline sends
SIGKILL to those groups itself before it exits. Processes the keeper adopted
are never added. If the watcher cannot start, the core logs
`groups.untied` once and agents run as they did before it. At startup the core
closes every trace row a previous core left open (`exited_at` set, no exit
code), through the partial index `processes_live`, before anything spawns; a
process the keeper still holds is written live again when it is adopted.

On Linux 6.9 and later, `spawn` and `spawnPiped` tie the group before the
agent runs instead (`platform/linux-launcher.ts`, `native/launch.c`). Bun
starts the launcher in the agent's place as a session leader. It opens a
pidfd on itself, hands it to the core's one guard over a socket (SCM_RIGHTS),
waits for the guard to answer that it holds it, hands the same pidfd to the
core over a close-on-exec status socket, and only then execs the agent. The
spawn reads that socket until the exec closes it; it throws a failed launch's
errno in Bun's own shape, and any other outcome (no pidfd, a short or broken
read, a launcher that ended without a word) stops the launch and throws
`ELAUNCH`. A guard with no descriptor left refuses the group and the launch
fails with `EMFILE` before the agent runs. So a core that dies right after
`Bun.spawn` returns, before the registry has the pid, still takes the group.
The guard and the core signal it only through the pidfd, with
`PIDFD_SIGNAL_PROCESS_GROUP`, the same grace as above: never through a
number the kernel may have handed out again. The empty probe after a
leader's exit and a shutdown's SIGKILL go through the core's pidfd too.
Because the core keeps its own pidfd of every group, a guard never costs a
group its identity: a guard found gone (the next launch fails with EPIPE
before the agent runs, or its exit is seen) is replaced by a new one that
receives every group still held, and a drop the guard does not take at once
(a full or broken socket) replaces it the same way, the new guard first, then
SIGKILL to the old one, so a released or keeper-held group is never ended at
the core's exit. Only a group the new guard refuses goes to the watcher by
pid. A core that dies after its guard and before it noticed leaves the groups
that guard held untied. At its first launch the core checks the whole path on
the launcher itself (pidfd_open, the guard's admission, a group signal
through the pidfd); a syscall filter that refuses one of them sends it to the
watcher with `groups.late`. The launcher sits next to the compiled core (`bin/compile.ts` builds it,
static, and fails without it) or in `native/build` from source
(`bin/build-launcher.ts`, run by the test runner). Without it, on an older
kernel or without glibc, the core logs `groups.late` once and the watcher
ties those groups as described above. Terminals, `spawnChild` (node) and
processes the keeper adopts still go through the watcher only.

`TraceCapability` exposes OS, mode (`events`, `poll`, `none`) and
failure notes; clients must read it before promising native capabilities.
