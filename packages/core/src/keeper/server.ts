/*
 * The keeper: a small process that starts what its core asks for and holds
 * it, so a core that restarts, updates or crashes leaves those processes
 * running. It holds each PTY's master end and the last
 * `KEEPER_PTY_HISTORY_BYTES` it printed, reaps exits, and hands all of it to
 * the next core that says `hello` with the token. It runs no driver, reads no
 * journal and loads no SDK.
 *
 * One core at a time. With no core attached it waits `KEEPER_ORPHAN_MS` for
 * one, then ends what it holds; with nothing to hold and no core it exits
 * after `KEEPER_IDLE_MS`. A `flock` on a file beside the socket keeps a second
 * keeper of the same data directory and protocol from starting.
 */

import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import type { Socket } from 'bun';
import { CORE_VERSION } from '../version.ts';
import { posixLockFile } from '../platform/posix-file-lock.ts';
import { endShell } from './end-shell.ts';
import { FrameSocket } from './frames.ts';
import {
  KEEPER_HELLO_MS, KEEPER_IDLE_MS, KEEPER_ORPHAN_MS, KEEPER_PENDING_BYTES, KEEPER_PROTOCOL, KEEPER_PTY_HISTORY_BYTES, KEEPER_SIGNALS,
  LineReader, decodeBytes, encodeBytes, keeperTokenPath,
  type FromKeeper, type KeptProcess, type KeeperSignal, type ToKeeper,
} from './protocol.ts';

/** How long an exit nobody collected is kept for the next core. */
const EXIT_KEPT_MS = 10 * 60_000;
const TICK_MS = 1_000;

/** The last bytes of a stream, kept as the chunks that came in. */
export class ByteRing {
  #chunks: Uint8Array[] = [];
  #length = 0;

  constructor(private readonly max: number) {}

  push(bytes: Uint8Array): void {
    this.#chunks.push(bytes);
    this.#length += bytes.length;
    while (this.#chunks.length > 1 && this.#length - this.#chunks[0]!.length >= this.max) {
      this.#length -= this.#chunks.shift()!.length;
    }
    // Still too long: the oldest chunk keeps its tail.
    if (this.#length > this.max) {
      this.#chunks[0] = this.#chunks[0]!.slice(this.#length - this.max);
      this.#length = this.max;
    }
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let at = 0;
    for (const chunk of this.#chunks) { out.set(chunk, at); at += chunk.length; }
    // A long-lived shell's history stays one chunk instead of thousands.
    this.#chunks = this.#length > 0 ? [out] : [];
    return out;
  }
}

interface Held {
  info: KeptProcess;
  proc: Bun.Subprocess;
  terminal: Bun.Terminal;
  history: ByteRing;
  /** Every byte it printed so far: where the history ends in its output. */
  written: number;
  /** The attached core asked for its output. */
  attached: boolean;
}

interface Connection { frames: FrameSocket<FromKeeper>; reader: LineReader; hello: boolean; timer: ReturnType<typeof setTimeout> | null }

export interface KeeperOptions {
  dataDir: string;
  socketPath: string;
  idleMs?: number;
  orphanMs?: number;
  log?: (line: string) => void;
}

export interface RunningKeeper {
  /** Resolves once the keeper stopped listening and ended what it held. */
  done: Promise<void>;
  stop(reason: string): Promise<void>;
}

function tokenOf(dataDir: string): Buffer {
  const parsed = JSON.parse(readFileSync(keeperTokenPath(dataDir), 'utf8')) as { token?: unknown };
  if (typeof parsed.token !== 'string' || parsed.token.length < 32) throw new Error(`${keeperTokenPath(dataDir)} must hold a token of at least 32 characters`);
  return Buffer.from(parsed.token);
}

function sameToken(expected: Buffer, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const bytes = Buffer.from(given);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}

/** Null when another keeper of this data directory and protocol already runs. */
export function startKeeper(options: KeeperOptions): RunningKeeper | null {
  const log = options.log ?? ((line: string) => process.stderr.write(`${new Date().toISOString()} ${line}\n`));
  const idleMs = options.idleMs ?? KEEPER_IDLE_MS;
  const orphanMs = options.orphanMs ?? KEEPER_ORPHAN_MS;
  const token = tokenOf(options.dataDir);
  const runtime = dirname(options.socketPath);
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  chmodSync(runtime, 0o700);
  const lock = posixLockFile(process.platform === 'darwin' ? 'macos' : 'linux')(`${options.socketPath}.lock`);
  if (lock === null) return null;
  // The lock says no keeper listens on it: what is left is a dead one's.
  rmSync(options.socketPath, { force: true });

  const held = new Map<string, Held>();
  let core: Connection | null = null;
  let nextId = 1;
  let lastCoreAt = Date.now();
  let emptySince = Date.now();
  let stopping: Promise<void> | null = null;
  const { promise: done, resolve: finished } = Promise.withResolvers<void>();

  const sendCore = (frame: FromKeeper) => { if (core?.hello) core.frames.send(frame); };

  const signalGroup = (pid: number, signal: KeeperSignal): void => {
    // A PTY's shell leads its own session and group.
    try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
  };

  /** Shells being ended: the keeper does not exit before their grace is over. */
  const ending = new Set<Promise<void>>();
  // The shell with what it started, a job in a group of its own included.
  const end = (entry: Held): Promise<void> => {
    if (entry.info.exit !== null) return Promise.resolve();
    const ended = endShell(entry.info.pid, entry.proc.exited).finally(() => ending.delete(ended));
    ending.add(ended);
    return ended;
  };

  // What a core that had `from` bytes lacks; all the history when it had none, or more than the history holds.
  const missed = (entry: Held, from: unknown): Uint8Array => {
    const kept = entry.history.bytes();
    if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) return kept;
    const lacking = entry.written - from;
    return lacking <= 0 ? kept.subarray(kept.length) : kept.subarray(Math.max(0, kept.length - lacking));
  };

  const spawn = (request: Extract<ToKeeper, { op: 'spawn' }>): void => {
    const id = `k${process.pid}-${nextId++}`;
    let entry: Held | null = null;
    const history = new ByteRing(KEEPER_PTY_HISTORY_BYTES);
    let proc: Bun.Subprocess;
    try {
      proc = Bun.spawn({
        cmd: [request.cmd, ...request.args],
        cwd: request.cwd,
        env: request.env,
        terminal: {
          cols: request.cols,
          rows: request.rows,
          data: (_terminal, bytes) => {
            const copy = new Uint8Array(bytes);
            history.push(copy);
            if (entry !== null) entry.written += copy.length;
            if (entry?.attached) sendCore({ op: 'data', id, data: encodeBytes(copy) });
          },
        },
      });
    } catch (error) {
      sendCore({ op: 'failed', req: request.req, message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const terminal = proc.terminal;
    if (terminal === undefined) {
      proc.kill();
      sendCore({ op: 'failed', req: request.req, message: 'this Bun gave the process no terminal' });
      return;
    }
    entry = { info: { id, pid: proc.pid, tag: request.tag, startedAt: Date.now(), exit: null }, proc, terminal, history, written: 0, attached: false };
    held.set(id, entry);
    const own = entry;
    void proc.exited.then((code) => code, () => null).then((code) => {
      own.info.exit = { code, at: Date.now() };
      try { own.terminal.close(); } catch { /* closed with the process */ }
      if (held.get(id) !== own) return;
      sendCore({ op: 'exit', id, code });
      // The attached core has its output and now its exit: nothing is left to hand over.
      if (own.attached && core?.hello === true) held.delete(id);
    });
    log(`started ${id} pid ${proc.pid}: ${request.cmd}`);
    sendCore({ op: 'spawned', req: request.req, process: entry.info });
  };

  const handle = (connection: Connection, frame: ToKeeper): void => {
    if (frame.op === 'hello') {
      if (!sameToken(token, frame.token)) { connection.frames.send({ op: 'refused', message: 'the keeper token does not match' }); connection.frames.close(); return; }
      if (frame.protocol !== KEEPER_PROTOCOL) { connection.frames.send({ op: 'refused', message: `this keeper speaks protocol ${KEEPER_PROTOCOL}, not ${frame.protocol}` }); connection.frames.close(); return; }
      if (core !== null && core !== connection) { connection.frames.send({ op: 'refused', message: `core pid ${frame.pid}: another core is attached` }); connection.frames.close(); return; }
      if (connection.timer !== null) clearTimeout(connection.timer);
      connection.hello = true;
      core = connection;
      lastCoreAt = Date.now();
      for (const entry of held.values()) entry.attached = false;
      log(`core pid ${frame.pid} (${frame.version}) attached, ${held.size} processes held`);
      connection.frames.send({ op: 'welcome', protocol: KEEPER_PROTOCOL, version: CORE_VERSION, pid: process.pid, processes: [...held.values()].map((entry) => entry.info) });
      return;
    }
    if (!connection.hello) { connection.frames.send({ op: 'refused', message: 'say hello first' }); connection.frames.close(); return; }
    if (frame.op === 'spawn') { if (stopping === null) spawn(frame); else sendCore({ op: 'failed', req: frame.req, message: 'the keeper is stopping' }); return; }
    const entry = held.get(frame.id);
    if (entry === undefined) return;
    switch (frame.op) {
      case 'attach':
        entry.attached = true;
        sendCore({ op: 'data', id: entry.info.id, data: encodeBytes(missed(entry, frame.from)), replay: true, at: entry.written });
        if (entry.info.exit !== null) {
          sendCore({ op: 'exit', id: entry.info.id, code: entry.info.exit.code });
          held.delete(entry.info.id);
        }
        return;
      case 'write':
        if (entry.info.exit === null && typeof frame.data === 'string') entry.terminal.write(decodeBytes(frame.data));
        return;
      case 'resize':
        if (entry.info.exit === null && Number.isInteger(frame.cols) && Number.isInteger(frame.rows) && frame.cols > 0 && frame.rows > 0) entry.terminal.resize(frame.cols, frame.rows);
        return;
      case 'signal':
        if (entry.info.exit === null && KEEPER_SIGNALS.includes(frame.signal)) signalGroup(entry.info.pid, frame.signal);
        return;
      case 'release':
        held.delete(frame.id);
        void end(entry);
        return;
    }
  };

  const listener = Bun.listen<Connection>({
    unix: options.socketPath,
    socket: {
      open(socket: Socket<Connection>) {
        const connection: Connection = { frames: new FrameSocket(socket as Socket<unknown>, KEEPER_PENDING_BYTES, () => log('a core stopped reading: its connection is dropped')), reader: new LineReader(), hello: false, timer: null };
        connection.timer = setTimeout(() => { if (!connection.hello) connection.frames.close(); }, KEEPER_HELLO_MS);
        socket.data = connection;
      },
      data(socket: Socket<Connection>, bytes: Buffer) {
        const connection = socket.data;
        let lines: string[];
        try { lines = connection.reader.push(bytes); } catch (error) { log(String(error)); connection.frames.close(); return; }
        for (const line of lines) {
          let frame: ToKeeper;
          try { frame = JSON.parse(line) as ToKeeper; } catch { connection.frames.close(); return; }
          handle(connection, frame);
        }
      },
      drain(socket: Socket<Connection>) { socket.data.frames.drain(); },
      close(socket: Socket<Connection>) {
        const connection = socket.data;
        connection.frames.gone();
        if (connection.timer !== null) clearTimeout(connection.timer);
        if (core === connection) {
          core = null;
          lastCoreAt = Date.now();
          for (const entry of held.values()) entry.attached = false;
          log(`core detached, ${[...held.values()].filter((entry) => entry.info.exit === null).length} processes running`);
        }
      },
      error(socket: Socket<Connection>, error: Error) { log(`socket error: ${error.message}`); socket.data.frames.gone(); },
    },
  });
  chmodSync(options.socketPath, 0o600);
  log(`keeper pid ${process.pid} listening on ${options.socketPath} (protocol ${KEEPER_PROTOCOL})`);

  const stop = (reason: string): Promise<void> => {
    if (stopping !== null) return stopping;
    log(`stopping: ${reason}`);
    sendCore({ op: 'stopping', reason });
    clearInterval(tick);
    stopping = Promise.all([...[...held.values()].map(end), ...ending]).then(() => {
      listener.stop(true);
      rmSync(options.socketPath, { force: true });
      lock.release();
      finished();
    });
    return stopping;
  };

  const tick = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of held) {
      if (core === null && entry.info.exit !== null && now - entry.info.exit.at > EXIT_KEPT_MS) held.delete(id);
    }
    const running = [...held.values()].some((entry) => entry.info.exit === null);
    // An attached core will want it again soon; one that holds nothing detaches.
    if (held.size > 0 || ending.size > 0 || core !== null) emptySince = now;
    if (core === null && running && now - lastCoreAt >= orphanMs) { void stop(`no core attached for ${Math.round(orphanMs / 1000)} s`); return; }
    if (held.size === 0 && now - emptySince >= idleMs) void stop('nothing to hold');
  }, TICK_MS);

  return { done, stop };
}

/** `boite-core --keeper --data-dir <dir> --socket <path>`: what `keeper/launch.ts` starts. */
export function runKeeper(argv: string[]): void {
  const value = (flag: string): string | undefined => { const at = argv.indexOf(flag); return at >= 0 ? argv[at + 1] : undefined; };
  const dataDir = value('--data-dir');
  const socketPath = value('--socket');
  if (dataDir === undefined || socketPath === undefined) {
    process.stderr.write('boite-core --keeper expects --data-dir <dir> and --socket <path>\n');
    process.exitCode = 2;
    return;
  }
  const number = (name: string): number | undefined => {
    const raw = process.env[name];
    return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;
  };
  const keeper = startKeeper({ dataDir, socketPath, idleMs: number('BOITE_KEEPER_IDLE_MS'), orphanMs: number('BOITE_KEEPER_ORPHAN_MS') });
  if (keeper === null) { process.stderr.write(`another keeper holds ${socketPath}\n`); return; }
  // Detached from any terminal: a hang-up is not for it.
  process.on('SIGHUP', () => undefined);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void keeper.stop(signal); });
  void keeper.done.then(() => process.exit(0));
}
