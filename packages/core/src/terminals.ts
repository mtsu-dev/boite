/*
 * Shells in a pseudo-terminal. A thread has up to `MAX_THREAD_TERMINALS`,
 * opened under the chat with Ctrl+J in the thread's working directory, and an
 * account whose CLI signs in through an interactive menu gets one with its
 * login command started in it. Each shell goes through `procs.spawnTerminal` under
 * its own trace id, never the thread's: stopping a turn must not take the
 * user's shell with it, and closing one tab must not take the others.
 */

import { existsSync } from 'node:fs';
import { release } from 'node:os';
import { win32 } from 'node:path';
import { MAX_THREAD_TERMINALS, THREAD_TERMINAL_KEY, isThreadTerminal, threadTerminalId } from '@boite/contracts';
import type { TerminalShell, TerminalState, ThreadId, ThreadTerminal } from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams, messageOf, notFound, refused } from './errors.ts';
import type { Router } from './router.ts';
import { HistoryAnnounce, defaultHistoryFile, describeShell, integrate, parseHistory, readHistoryTail } from './terminal-integration.ts';
import { KeeperClient, keeperEnabled, type KeptTerminal } from './keeper/client.ts';
import { adoptKeptTerminal, spawnKeptTerminal } from './keeper/kept-terminal.ts';
import type { KeptProcess, KeptTag } from './keeper/protocol.ts';
import type { SpawnedKeptTerminal } from './process-spawn-types.ts';

/** What a late client is sent to redraw the screen. A full-screen app redraws itself anyway. */
export const HISTORY_CHARS = 256 * 1024;
/**
 * Output that follows other output within this window goes out as one event. The
 * first chunk after a quiet window goes at once, so a typed key echoes without delay.
 */
export const OUTPUT_WINDOW_MS = 16;
/** How far into a cut history the first line break is looked for. */
const LINE_SEARCH_CHARS = 4096;
/** Chunks the history holds before it joins them into one string. */
const HISTORY_CHUNKS = 4096;
/** The shell prints its prompt, then goes quiet: that is when a typed command lands on it. */
const PROMPT_QUIET_MS = 250;
/** A shell that never goes quiet still gets the command. */
const PROMPT_TIMEOUT_MS = 5000;
const CLOSE_TIMEOUT_MS = 5000;

/**
 * What the emulator needs to know about ConPTY: the third number of `10.0.26100`.
 * Nothing elsewhere, and nothing when the release does not read that way.
 */
export function windowsPty(
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release(),
): Pick<TerminalState, 'windowsPty'> {
  if (platform !== 'win32') return {};
  const buildNumber = Number(osRelease.split('.')[2]);
  return Number.isInteger(buildNumber) && buildNumber > 0 ? { windowsPty: { buildNumber } } : {};
}

export { threadTerminalId };

export interface Shell {
  exe: string;
  args: string[];
  kind: 'powershell' | 'cmd' | 'posix';
}

/**
 * `BOITE_TERMINAL_SHELL` when set, else PowerShell 7 when it is on the PATH,
 * the Windows PowerShell every Windows has, then cmd. `$SHELL` elsewhere, then
 * bash, then sh. On macOS a login shell, as Terminal.app starts: zsh reads
 * `/etc/zprofile` and `~/.zprofile` only then, and that is where Homebrew and
 * most version managers put their PATH.
 */
export function pickShell(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  which: (name: string) => string | null = (name) => Bun.which(name),
  exists: (path: string) => boolean = existsSync,
): Shell {
  const chosen = env['BOITE_TERMINAL_SHELL'];
  if (chosen !== undefined && chosen.length > 0) {
    const name = (platform === 'win32' ? win32.basename(chosen) : chosen.split('/').pop() ?? chosen).toLowerCase();
    if (/^(pwsh|powershell)(\.exe)?$/.test(name)) return { exe: chosen, args: ['-NoLogo'], kind: 'powershell' };
    return { exe: chosen, args: [], kind: /^cmd(\.exe)?$/.test(name) ? 'cmd' : 'posix' };
  }
  if (platform === 'win32') {
    const pwsh = which('pwsh.exe');
    if (pwsh !== null) return { exe: pwsh, args: ['-NoLogo'], kind: 'powershell' };
    const root = env['SystemRoot'] ?? env['windir'] ?? 'C:\\Windows';
    const windowsPowerShell = win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (exists(windowsPowerShell)) return { exe: windowsPowerShell, args: ['-NoLogo'], kind: 'powershell' };
    return { exe: env['ComSpec'] ?? win32.join(root, 'System32', 'cmd.exe'), args: [], kind: 'cmd' };
  }
  const args = platform === 'darwin' ? ['-l'] : [];
  const named = env['SHELL'];
  if (named !== undefined && named.length > 0 && exists(named)) return { exe: named, args, kind: 'posix' };
  return { exe: exists('/bin/bash') ? '/bin/bash' : '/bin/sh', args, kind: 'posix' };
}

/** The line a user would type to run `argv` in this shell, quoted where it has to be. */
export function commandLine(kind: Shell['kind'], argv: string[]): string {
  if (kind === 'powershell') {
    // The call operator runs a quoted path, which PowerShell would print as a string.
    return `& ${argv.map((part) => (/^[\w.:\\/-]+$/.test(part) ? part : `'${part.replaceAll("'", "''")}'`)).join(' ')}`;
  }
  if (kind === 'cmd') return argv.map((part) => (/^[\w.:\\/-]+$/.test(part) ? part : `"${part}"`)).join(' ');
  return argv.map((part) => (/^[\w.:/=@-]+$/.test(part) ? part : `'${part.replaceAll("'", `'\\''`)}'`)).join(' ');
}

/**
 * The last `max` characters of a stream, kept as the chunks that came in. A busy
 * shell prints tens of thousands of small chunks: appending each to one 256 KB
 * string and slicing it again copied the whole history per chunk.
 */
export class OutputHistory {
  #chunks: string[] = [];
  private length = 0;

  constructor(private readonly max = HISTORY_CHARS) {}

  push(data: string): void {
    this.#chunks.push(data);
    this.length += data.length;
    // Drop whole chunks while what is left still covers the window.
    while (this.#chunks.length > 1 && this.length - this.#chunks[0]!.length >= this.max) {
      this.length -= this.#chunks.shift()!.length;
    }
    if (this.#chunks.length > HISTORY_CHUNKS) {
      const joined = this.text();
      this.#chunks = [joined];
      this.length = joined.length;
    }
  }

  /**
   * A cut window starts on a line of its own: the cut can land inside an
   * escape sequence, and the half that is left draws as stray characters at
   * the top of the screen a client redraws.
   */
  text(): string {
    const all = this.#chunks.join('');
    if (all.length <= this.max) return all;
    const cut = all.slice(-this.max);
    const line = cut.indexOf('\n');
    return line === -1 || line > LINE_SEARCH_CHARS ? cut : cut.slice(line + 1);
  }
}

/** What a session types into and resizes: Bun's own PTY, or one the keeper holds. */
interface SessionTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

/** What the keeper stores beside a thread's shell, so the next core can describe it again. */
interface TerminalTag {
  kind: 'terminal';
  id: string;
  cwd: string;
  threadId: string | null;
  shell: TerminalShell;
  exe: string;
  args: string[];
}

function terminalTag(tag: KeptTag): TerminalTag | null {
  const value = tag as Partial<TerminalTag>;
  const shell = value.shell as Partial<TerminalShell> | undefined;
  if (value.kind !== 'terminal' || typeof value.id !== 'string' || typeof value.cwd !== 'string' || typeof value.exe !== 'string') return null;
  if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string')) return null;
  if (value.threadId !== null && typeof value.threadId !== 'string') return null;
  if (shell === undefined || typeof shell.name !== 'string' || typeof shell.integrated !== 'boolean' || !['powershell', 'cmd', 'posix'].includes(shell.kind as string)) return null;
  return value as TerminalTag;
}

/** The output side of one shell, shared by a shell this core runs and one the keeper holds. */
interface Output {
  id: string;
  shell: Shell;
  /** What is started: the shell, or `/bin/sh` running a login command first. */
  launchShell: { exe: string; args: string[] };
  prepared: boolean;
  described: TerminalShell;
  env: Record<string, string | undefined>;
  announce: HistoryAnnounce | null;
  history: OutputHistory;
  sequence: number;
  held: string;
  gate: ReturnType<typeof setTimeout> | null;
  emit(data: string): void;
  feed(bytes: Uint8Array): void;
}

interface Session {
  id: string;
  cwd: string;
  terminal: SessionTerminal;
  /** Held by the keeper: a core that stops lets go of it instead of killing it. */
  kept: KeptTerminal | null;
  sequence: number;
  /** Exactly what `terminal.output` events carried so far, so a snapshot and the events after it never overlap. */
  history: OutputHistory;
  exited: Promise<number | null>;
  /** Killed, not gone yet: it takes no keys, and its id is not free for a new shell. */
  closing: boolean;
  shell: TerminalShell;
  /** The history file the shell's integration named, else its default. */
  historyFile: () => string | null;
}

export interface StartOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  /** A login command started before the POSIX shell, or typed at its Windows prompt. */
  type?: string[];
  onExit?: () => void;
  /** The thread a thread's shell belongs to, set on its log records. */
  threadId?: ThreadId;
  /** Start bash or PowerShell with the shell integration: a thread's shell, never a login one. */
  integrate?: boolean;
}

export class TerminalStore {
  readonly #sessions = new Map<string, Session>();
  /**
   * The connections that attached each shell: `terminal.output` goes to them
   * only. A window without that pane would drop the bytes anyway.
   */
  readonly #watchers = new Map<string, Set<string>>();

  readonly #core: Core;
  /** Set with `BOITE_KEEPER=1`: thread shells then outlive the core (`keeper/`). */
  readonly #keeper: KeeperClient | null;
  /** Thread shells waiting for the keeper to start them. */
  readonly #opening = new Map<string, Promise<TerminalState>>();
  /** Settled once the shells an earlier core left with the keeper have their sessions back. */
  readonly #restored: Promise<void>;

  constructor(core: Core) {
    this.#core = core;
    this.#keeper = keeperEnabled() ? new KeeperClient({ dataDir: core.dataDir, log: (level, message) => core.log(level, message) }) : null;
    this.#restored = this.#keeper === null ? Promise.resolve() : this.#restore(this.#keeper);
  }

  /** Settled once the shells kept across the last restart are back. */
  get ready(): Promise<void> { return this.#restored; }

  get keeps(): boolean { return this.#keeper !== null; }

  /** The keeper's client, null unless `BOITE_KEEPER=1`. */
  get keeper(): KeeperClient | null { return this.#keeper; }

  /** The connection attached shell `id`: from now on its output reaches it. */
  watch(id: string, connectionId: string): void {
    const watching = this.#watchers.get(id);
    if (watching === undefined) this.#watchers.set(id, new Set([connectionId]));
    else watching.add(connectionId);
  }

  watches(id: string, connectionId: string): boolean {
    return this.#watchers.get(id)?.has(connectionId) === true;
  }

  /** The connection let go of shell `id`. */
  unwatch(id: string, connectionId: string): void {
    const watching = this.#watchers.get(id);
    watching?.delete(connectionId);
    if (watching?.size === 0) this.#watchers.delete(id);
  }

  /**
   * The `terminal.exited` of shell `id` went out, after every line it printed:
   * nobody watches it any more, unless a shell of the same id started since.
   */
  exitSent(id: string): void {
    if (!this.#sessions.has(id)) this.#watchers.delete(id);
  }

  /** The socket closed: it watches nothing any more. */
  disconnect(connectionId: string): void {
    for (const id of [...this.#watchers.keys()]) this.unwatch(id, connectionId);
  }

  /** One of the thread's shells, started in its working directory the first time. */
  openThread(threadId: ThreadId, cols: number, rows: number, terminalId?: string): TerminalState {
    if (terminalId !== undefined && (typeof terminalId !== 'string' || !THREAD_TERMINAL_KEY.test(terminalId))) {
      throw invalidParams(`terminalId must be term-2 to term-${MAX_THREAD_TERMINALS}, not ${JSON.stringify(terminalId)}`, { field: 'terminalId', expected: `term-2 to term-${MAX_THREAD_TERMINALS}` });
    }
    const thread = this.#core.threads.require(threadId);
    if (thread.archived) throw refused(`the thread ${threadId} is archived`, { threadId, field: 'archived', expected: false });
    // The ids bound the count: the first shell and `term-2` to `term-16`.
    const id = threadTerminalId(threadId, terminalId);
    return this.open(id, { cwd: thread.cwd, env: { ...process.env }, cols, rows, threadId, integrate: true });
  }

  /** `openThread`, started by the keeper when it is on. */
  async openThreadKept(threadId: ThreadId, cols: number, rows: number, terminalId?: string): Promise<TerminalState> {
    if (this.#keeper === null) return this.openThread(threadId, cols, rows, terminalId);
    if (terminalId !== undefined && (typeof terminalId !== 'string' || !THREAD_TERMINAL_KEY.test(terminalId))) {
      throw invalidParams(`terminalId must be term-2 to term-${MAX_THREAD_TERMINALS}, not ${JSON.stringify(terminalId)}`, { field: 'terminalId', expected: `term-2 to term-${MAX_THREAD_TERMINALS}` });
    }
    const thread = this.#core.threads.require(threadId);
    if (thread.archived) throw refused(`the thread ${threadId} is archived`, { threadId, field: 'archived', expected: false });
    return this.openKept(threadTerminalId(threadId, terminalId), { cwd: thread.cwd, env: { ...process.env }, cols, rows, threadId, integrate: true });
  }

  /** The thread's running shells, in the order they started. A closing one is gone already. */
  listThread(threadId: ThreadId): ThreadTerminal[] {
    const first = threadTerminalId(threadId);
    return this.#threadSessions(threadId).filter((session) => !session.closing).map((session) => ({
      id: session.id,
      ...(session.id === first ? {} : { terminalId: session.id.slice(first.length + 1) }),
      cwd: session.cwd,
    }));
  }

  /** Closes every shell of the thread. */
  async closeThread(threadId: ThreadId): Promise<void> {
    await Promise.all(this.#threadSessions(threadId).map((session) => this.close(session.id)));
  }

  /**
   * Kills every shell of the thread and waits for its processes to be gone, a
   * leftover whose session went already included: the records go next.
   */
  async stopThread(threadId: ThreadId): Promise<void> {
    const ids = new Set([...this.#threadSessions(threadId).map((session) => session.id), ...this.#core.procs.liveThreads().filter((id) => isThreadTerminal(threadId, id))]);
    await Promise.all([...ids].map((id) => this.#core.procs.stopAndWait(id as ThreadId)));
  }

  /** How many processes the thread's shells run. */
  threadProcesses(threadId: ThreadId): number {
    return this.#core.procs.liveThreads().filter((id) => isThreadTerminal(threadId, id)).reduce((sum, id) => sum + this.#core.procs.liveCount(id), 0);
  }

  #threadSessions(threadId: ThreadId): Session[] {
    return [...this.#sessions.values()].filter((session) => isThreadTerminal(threadId, session.id));
  }

  /** The running shell under this id, resized to the client that attaches, or a new one. */
  open(id: string, options: StartOptions): TerminalState {
    const running = this.#running(id, options);
    if (running !== null) return running;
    const output = this.#output(id, options, this.#shellFor(options));
    const { shell, launchShell: launch } = output;
    let typed = options.type === undefined || output.prepared;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let session: Session | null = null;
    const typeNow = () => {
      if (typed || session === null) return;
      typed = true;
      if (quiet !== null) clearTimeout(quiet);
      clearTimeout(fallback);
      session.terminal.write(`${commandLine(shell.kind, options.type ?? [])}\r`);
    };
    const fallback = setTimeout(typeNow, PROMPT_TIMEOUT_MS);
    if (typed) clearTimeout(fallback);
    let spawned;
    try {
      spawned = this.#core.procs.spawnTerminal(id, launch.exe, launch.args, {
        cwd: options.cwd,
        env: output.env,
        cols: options.cols,
        rows: options.rows,
        onData: (bytes) => {
          output.feed(bytes);
          if (!typed) {
            if (quiet !== null) clearTimeout(quiet);
            quiet = setTimeout(typeNow, PROMPT_QUIET_MS);
          }
        },
      });
    } catch (error) {
      clearTimeout(fallback);
      throw refused(`the shell ${launch.exe} did not start: ${messageOf(error)}`, { id, shell: launch.exe });
    }
    session = this.#begin(output, options, spawned.terminal, spawned.exited, () => {
      clearTimeout(fallback);
      if (quiet !== null) clearTimeout(quiet);
    });
    return this.#state(session);
  }

  /**
   * `open` for a thread's shell when the keeper is on: the keeper starts it
   * and holds it, so it outlives this core. A second open of the same id while
   * the first one waits for the keeper gets the same shell.
   */
  openKept(id: string, options: StartOptions): Promise<TerminalState> {
    const opening = this.#opening.get(id);
    if (opening !== undefined) return opening.then(() => this.open(id, options));
    const keeper = this.#keeper;
    if (keeper === null || options.type !== undefined) return Promise.resolve(this.open(id, options));
    const started = this.#restored.then(async () => {
      const running = this.#running(id, options);
      if (running !== null) return running;
      const output = this.#output(id, options, this.#shellFor(options));
      const launch = output.launchShell;
      const tag: TerminalTag = { kind: 'terminal', id, cwd: options.cwd, threadId: options.threadId ?? null, shell: output.described, exe: launch.exe, args: launch.args };
      let spawned;
      try {
        spawned = await spawnKeptTerminal(this.#core.procs, keeper, id as ThreadId, launch.exe, launch.args, { cwd: options.cwd, env: output.env, cols: options.cols, rows: options.rows, tag: { ...tag } });
      } catch (error) {
        throw refused(`the shell ${launch.exe} did not start: ${messageOf(error)}`, { id, shell: launch.exe });
      }
      return this.#state(this.#adopt(output, options, spawned));
    });
    this.#opening.set(id, started);
    void started.finally(() => { if (this.#opening.get(id) === started) this.#opening.delete(id); }).catch(() => undefined);
    return started;
  }

  /** The shell already running under this id, resized to the client, or null. */
  #running(id: string, options: { cols: number; rows: number; cwd: string }): TerminalState | null {
    checkSize(options.cols, options.rows);
    const running = this.#sessions.get(id);
    if (running !== undefined) {
      if (running.closing) throw refused(`the shell ${id} is still closing, open it again in a moment`, { id });
      running.terminal.resize(options.cols, options.rows);
      return this.#state(running);
    }
    if (!existsSync(options.cwd)) {
      throw refused(`the working directory ${options.cwd} does not exist any more`, { id, cwd: options.cwd });
    }
    return null;
  }

  #shellFor(options: StartOptions): { shell: Shell; integrated: boolean } {
    const picked = pickShell();
    return options.integrate === true ? integrate(picked, this.#core.dataDir) : { shell: picked, integrated: false };
  }

  #state(session: Session): TerminalState {
    return { id: session.id, cwd: session.cwd, output: session.history.text(), sequence: session.sequence, shell: session.shell, ...windowsPty() };
  }

  /**
   * What turns a shell's bytes into `terminal.output` events: masked, kept in
   * the history, the first chunk after a quiet window sent at once and the
   * rest batched every `OUTPUT_WINDOW_MS`.
   */
  #output(id: string, options: Pick<StartOptions, 'threadId' | 'type' | 'env'>, picked: { shell: Shell; integrated: boolean }, described?: TerminalShell): Output {
    const { shell, integrated } = picked;
    const announce = integrated ? new HistoryAnnounce() : null;
    const decoder = new TextDecoder();
    const history = new OutputHistory();
    // POSIX logins run as startup argv before opening the user's shell. A
    // quiet profile may still be reading stdin, so PTY keystrokes cannot start them safely.
    const prepared = process.platform !== 'win32' && options.type !== undefined;
    const launchShell = prepared ? {
      exe: '/bin/sh',
      args: ['-c', `"$@"\nexec ${commandLine('posix', [shell.exe, ...shell.args])}`, 'boite-login', ...(options.type ?? [])],
    } : shell;
    const output: Output = {
      id, shell, launchShell, prepared, announce, history, sequence: 0, held: '', gate: null,
      described: described ?? describeShell(shell, integrated),
      env: { ...options.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      emit: (data) => {
        // A value split across two chunks passes; one whole in a chunk is masked (docs/secrets.md).
        if (options.threadId !== undefined) data = this.#core.secrets.mask(options.threadId, data);
        history.push(data);
        output.sequence++;
        const session = this.#sessions.get(id);
        if (session !== undefined && session.history === history) session.sequence = output.sequence;
        this.#core.bus.emit('terminal.output', { id, data, sequence: output.sequence });
      },
      feed: (bytes) => {
        const data = decoder.decode(bytes, { stream: true });
        if (data.length === 0) return;
        announce?.feed(data);
        if (output.gate === null) {
          output.emit(data);
          output.gate = setTimeout(release, OUTPUT_WINDOW_MS);
        } else output.held += data;
      },
    };
    const release = () => {
      if (output.held.length === 0) {
        output.gate = null;
        return;
      }
      const data = output.held;
      output.held = '';
      output.emit(data);
      output.gate = setTimeout(release, OUTPUT_WINDOW_MS);
    };
    return output;
  }

  /** The session of a shell that just started, its exit logged and sent after its last lines. */
  #begin(output: Output, options: StartOptions, terminal: SessionTerminal, exited: Promise<number | null>, cleanup: () => void, kept?: KeptTerminal): Session {
    const id = output.id;
    const openedAt = Date.now();
    const shellName = output.shell.exe.split(/[\\/]/).pop() ?? 'shell';
    const owner = options.threadId === undefined ? {} : { threadId: options.threadId };
    let session: Session | null = null;
    this.#core.logs.info(`Terminal ${id} ${kept === undefined ? 'opened' : 'kept'} with ${shellName}`, { source: 'terminals', event: 'terminal.opened', ...owner, data: { id, shell: shellName, kept: kept !== undefined } });
    const done = exited.then(
      (code) => code,
      () => null,
    ).then((code) => {
      // A shell exits with its last command's status: a failed `false; exit` is a routine close.
      this.#core.logs.info(`Terminal ${id} (${shellName}) exited with code ${code ?? 'unknown'} after ${Math.round((Date.now() - openedAt) / 1000)} s`, {
        source: 'terminals', event: 'terminal.exited', ...owner, durationMs: Date.now() - openedAt, data: { id, shell: shellName, exitCode: code },
      });
      cleanup();
      kept?.release();
      if (output.gate !== null) clearTimeout(output.gate);
      output.gate = null;
      if (this.#sessions.get(id) === session) this.#sessions.delete(id);
      if (!this.#core.journal.isClosed()) {
        // The last lines a shell printed go out before its exit, never after.
        if (output.held.length > 0) output.emit(output.held);
        output.held = '';
        this.#core.bus.emit('terminal.exited', { id, exitCode: code });
      }
      options.onExit?.();
      return code;
    });
    session = {
      id, cwd: options.cwd, terminal, sequence: output.sequence, history: output.history, exited: done, closing: false, shell: output.described,
      historyFile: () => output.announce?.path ?? defaultHistoryFile(output.described, process.platform, options.env),
      kept: kept ?? null,
    };
    this.#sessions.set(id, session);
    return session;
  }

  /** A kept shell's session: its output wired, then asked for, what the keeper kept first. */
  #adopt(output: Output, options: StartOptions, spawned: SpawnedKeptTerminal): Session {
    const { kept } = spawned;
    kept.onData((bytes) => output.feed(bytes));
    const session = this.#begin(output, options, kept, spawned.exited, () => undefined, kept);
    kept.attach();
    return session;
  }

  /**
   * Once at startup, with the keeper on: the thread shells an earlier core
   * left with it get their sessions back, with what they printed meanwhile.
   * Anything else it held for this data directory is ended: a shell of a
   * thread gone since, one that exited while no core was attached, a second
   * one under the same id.
   */
  async #restore(keeper: KeeperClient): Promise<void> {
    let held;
    try { held = await keeper.connect({ launch: false }); } catch (error) {
      this.#core.log('warn', `the keeper did not answer, its shells are not restored: ${messageOf(error)}`);
      return;
    }
    if (held === null) return;
    const newest = new Map<string, KeptProcess>();
    for (const info of held) {
      const tag = terminalTag(info.tag);
      const previous = tag === null ? undefined : newest.get(tag.id);
      if (tag === null || info.exit !== null) { keeper.adopt(info).release(); continue; }
      if (previous !== undefined && previous.startedAt >= info.startedAt) { keeper.adopt(info).release(); continue; }
      if (previous !== undefined) keeper.adopt(previous).release();
      newest.set(tag.id, info);
    }
    let restored = 0;
    for (const info of newest.values()) {
      const tag = terminalTag(info.tag)!;
      const thread = tag.threadId === null ? null : this.#core.journal.getThread(tag.threadId as ThreadId);
      const kept = keeper.adopt(info);
      if (thread === null || thread.archived || this.#sessions.has(tag.id)) { kept.release(); continue; }
      const options: StartOptions = { cwd: tag.cwd, env: { ...process.env }, cols: 80, rows: 24, threadId: thread.id, integrate: tag.shell.integrated };
      const output = this.#output(tag.id, options, { shell: { exe: tag.exe, args: tag.args, kind: tag.shell.kind }, integrated: tag.shell.integrated }, tag.shell);
      try {
        this.#adopt(output, options, adoptKeptTerminal(this.#core.procs, tag.id as ThreadId, kept, tag.exe, tag.args));
        restored++;
      } catch (error) {
        this.#core.log('warn', `the kept shell ${tag.id} could not be taken back: ${messageOf(error)}`);
        kept.release();
      }
    }
    keeper.detachWhenIdle();
    if (restored > 0) this.#core.logs.info(`Took back ${restored} shells the keeper held`, { source: 'terminals', event: 'terminal.restored', data: { count: restored } });
  }

  has(id: string): boolean {
    return this.#sessions.has(id);
  }

  write(id: string, data: string): { ok: true } {
    this.require(id).terminal.write(data);
    return { ok: true };
  }

  resize(id: string, cols: number, rows: number): { ok: true } {
    checkSize(cols, rows);
    this.require(id).terminal.resize(cols, rows);
    return { ok: true };
  }

  /**
   * Kills the shell with everything it started, and waits for it to be gone.
   * The session stops taking keys at once, even when the exit is slow, and
   * keeps its id until the exit so a new shell never shares it.
   */
  async close(id: string): Promise<{ ok: true }> {
    const session = this.#sessions.get(id);
    if (session === undefined) return { ok: true };
    session.closing = true;
    this.#core.procs.killTree(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      session.exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    return { ok: true };
  }

  /** The shell's recent commands, newest first, from the file its integration named or its default one. */
  history(id: string): { commands: string[] } {
    const session = this.require(id);
    const file = session.historyFile();
    if (file === null) return { commands: [] };
    const text = readHistoryTail(file);
    return { commands: text === null ? [] : parseHistory(text, session.shell.kind) };
  }

  /**
   * Core shutdown: this core's shells are killed. The keeper's stay with it
   * through a restart or an update, let go of here without an exit, for the
   * next core to take back; an explicit stop (`Core.endsKept`) ends them too.
   */
  async closeAll(): Promise<void> {
    await this.#restored;
    await Promise.allSettled([...this.#opening.values()]);
    if (!this.#core.endsKept) {
      for (const session of [...this.#sessions.values()]) {
        if (session.kept === null || session.closing) continue;
        this.#sessions.delete(session.id);
        this.#core.procs.disown(session.id as ThreadId);
      }
    }
    await Promise.all([...this.#sessions.keys()].map((id) => this.close(id)));
    this.#keeper?.close();
  }

  private require(id: string): Session {
    const session = this.#sessions.get(id);
    if (session === undefined || session.closing) throw notFound(`no terminal is running as ${id}`, { id });
    return session;
  }
}

function checkSize(cols: unknown, rows: unknown): void {
  if (!Number.isInteger(cols) || (cols as number) < 2 || (cols as number) > 1000) {
    throw invalidParams('cols must be an integer from 2 to 1000', { field: 'cols', expected: '2..1000' });
  }
  if (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > 500) {
    throw invalidParams('rows must be an integer from 1 to 500', { field: 'rows', expected: '1..500' });
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidParams(`${field} must be a non-empty string`, { field });
  }
  return value;
}

export function registerTerminalMethods(core: Core): void {
  const router: Router = core.router;
  router.register('terminals.open', async (params, ctx) => {
    const threadId = requireString(params.threadId, 'threadId') as ThreadId;
    const state = core.terminals.keeps
      ? await core.terminals.openThreadKept(threadId, params.cols, params.rows, params.terminalId)
      : core.terminals.openThread(threadId, params.cols, params.rows, params.terminalId);
    core.terminals.watch(state.id, ctx.connection.id);
    return state;
  });
  router.register('terminals.list', async (params) => {
    const threadId = requireString(params.threadId, 'threadId') as ThreadId;
    core.threads.require(threadId);
    await core.terminals.ready;
    return core.terminals.listThread(threadId);
  });
  router.register('terminals.write', (params) => {
    if (typeof params.data !== 'string') throw invalidParams('data must be a string', { field: 'data' });
    return core.terminals.write(requireString(params.id, 'id'), params.data);
  });
  router.register('terminals.resize', (params) =>
    core.terminals.resize(requireString(params.id, 'id'), params.cols, params.rows));
  router.register('terminals.close', (params, ctx) => {
    const id = requireString(params.id, 'id');
    // The closing window's pane goes now; the others keep the last lines until `terminal.exited`.
    core.terminals.unwatch(id, ctx.connection.id);
    return core.terminals.close(id);
  });
  router.register('terminals.history', (params) => core.terminals.history(requireString(params.id, 'id')));
}
