/*
 * The core's side of the keeper (`keeper/server.ts`): connects to the keeper
 * of its data directory, starts one when asked to and none is there, and
 * hands each kept process to its owner as a `KeptTerminal`. A core that
 * closes only lets go of the socket: what the keeper holds keeps running for
 * the next core.
 *
 * Off by default: `BOITE_KEEPER=1` turns it on, Linux and macOS only.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Socket } from 'bun';
import { CORE_VERSION } from '../version.ts';
import { newToken } from '../ids.ts';
import { FrameSocket } from './frames.ts';
import { KeptChild } from './kept-child.ts';
import { launchKeeper } from './launch.ts';
import {
  KEEPER_PENDING_BYTES, KEEPER_PROTOCOL, LineReader, decodeBytes, encodeBytes, keeperSocketPath, keeperTokenPath,
  type FromKeeper, type KeptProcess, type KeptTag, type KeeperSignal, type ToKeeper,
} from './protocol.ts';

/** How long a keeper that was just started has to listen. */
const LAUNCH_MS = 5_000;
const LAUNCH_POLL_MS = 50;
/** How long `welcome` and `spawned` may take. */
const ANSWER_MS = 5_000;

export function keeperEnabled(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): boolean {
  return env['BOITE_KEEPER'] === '1' && (platform === 'linux' || platform === 'darwin');
}

/** The token the keeper checks, created on first use, owner only. */
export function keeperToken(dataDir: string): string {
  const file = keeperTokenPath(dataDir);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { token?: unknown };
      if (typeof parsed.token === 'string' && parsed.token.length >= 32) return parsed.token;
    } catch { /* cut short or edited by hand: a new token replaces it */ }
  }
  const token = newToken();
  writeFileSync(file, `${JSON.stringify({ token })}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

/** One process the keeper holds for this core. */
export class KeptTerminal {
  readonly id: string;
  readonly pid: number;
  readonly tag: KeptTag;
  readonly startedAt: number;
  readonly exited: Promise<number | null>;
  #exit: (code: number | null) => void;
  #done = false;
  #onData: ((bytes: Uint8Array, replay: boolean) => void) | null = null;
  /** How many of its bytes this core has, once a replay said where they end. */
  #received: number | null = null;
  readonly #send: (frame: ToKeeper) => void;

  constructor(info: KeptProcess, send: (frame: ToKeeper) => void) {
    this.id = info.id; this.pid = info.pid; this.tag = info.tag; this.startedAt = info.startedAt;
    this.#send = send;
    const { promise, resolve } = Promise.withResolvers<number | null>();
    this.exited = promise;
    this.#exit = resolve;
    if (info.exit !== null) this.ended(info.exit.code);
  }

  get running(): boolean { return !this.#done; }

  /**
   * Its output. Set before `attach`: the first frame is what the keeper kept
   * (`replay`), every later one live, in order, called in the frame's own tick.
   */
  onData(listener: (bytes: Uint8Array, replay: boolean) => void): void { this.#onData = listener; }

  /**
   * Asks the keeper for the output: what it kept first, then the live bytes.
   * Attached again after a lost connection, only what this core missed.
   */
  attach(): void {
    if (this.#done) return;
    this.#send(this.#received === null ? { op: 'attach', id: this.id } : { op: 'attach', id: this.id, from: this.#received });
  }

  write(data: string | Uint8Array): void {
    if (this.#done) return;
    this.#send({ op: 'write', id: this.id, data: encodeBytes(typeof data === 'string' ? new TextEncoder().encode(data) : data) });
  }

  resize(cols: number, rows: number): void { if (!this.#done) this.#send({ op: 'resize', id: this.id, cols, rows }); }

  signal(signal: KeeperSignal): void { if (!this.#done) this.#send({ op: 'signal', id: this.id, signal }); }

  /** Ends it if it runs, and the keeper forgets it: no exit code comes back after this. */
  release(): void {
    this.#send({ op: 'release', id: this.id });
    this.ended(null);
  }

  /** @internal */
  data(bytes: Uint8Array, replay: boolean, at?: number): void {
    if (replay && at !== undefined) this.#received = at;
    else if (this.#received !== null) this.#received += bytes.length;
    this.#onData?.(bytes, replay);
  }

  /** @internal */
  ended(code: number | null): void {
    if (this.#done) return;
    this.#done = true;
    this.#exit(code);
  }
}

interface Waiting { resolve: (process: KeptProcess) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export interface KeeperClientOptions {
  dataDir: string;
  log: (level: 'info' | 'warn', message: string) => void;
  /** Tests start the keeper their own way. */
  launch?: (dataDir: string, socketPath: string) => Promise<void>;
  env?: Record<string, string | undefined>;
}

export class KeeperClient {
  readonly socketPath: string;
  readonly #options: KeeperClientOptions;
  #frames: FrameSocket<ToKeeper> | null = null;
  #connecting: Promise<KeptProcess[] | null> | null = null;
  readonly #kept = new Map<string, KeptTerminal | KeptChild>();
  /** Set while agent processes may be kept: the socket stays open with nothing held, so the next spawn needs no connect. */
  #stayAttached = false;
  readonly #listing = new Map<number, (processes: KeptProcess[]) => void>();
  readonly #waiting = new Map<number, Waiting>();
  #nextRequest = 1;
  #closed = false;
  #welcome: ((processes: KeptProcess[]) => void) | null = null;
  #refused: ((message: string) => void) | null = null;

  constructor(options: KeeperClientOptions) {
    this.#options = options;
    this.socketPath = keeperSocketPath(options.dataDir, options.env);
  }

  get connected(): boolean { return this.#frames !== null && !this.#frames.closed; }

  /** Connected, or on the way: a spawn asked now is sent once it is. */
  get reachable(): boolean { return this.connected || this.#connecting !== null; }

  /** Keeps the socket open while this core runs, even holding nothing. */
  stayAttached(): void { this.#stayAttached = true; }

  /** The keeper's pid, from the last `welcome`. */
  get keeperPid(): number | null { return this.#keeperPid; }
  #keeperPid: number | null = null;

  /**
   * Attaches to the keeper. With `launch`, one is started when none listens.
   * Resolves with what it held when this core attached, or null when there is
   * no keeper and none was to be started.
   */
  connect(options: { launch: boolean }): Promise<KeptProcess[] | null> {
    if (this.#closed) return Promise.resolve(null);
    if (this.connected) return Promise.resolve([]);
    if (this.#connecting !== null) return this.#connecting;
    this.#connecting = this.#connect(options.launch).finally(() => { this.#connecting = null; });
    return this.#connecting;
  }

  /** A kept process from the `welcome` list, owned by the caller from now on. */
  adopt(info: KeptProcess): KeptTerminal {
    const existing = this.#kept.get(info.id);
    if (existing instanceof KeptTerminal) return existing;
    const kept = new KeptTerminal(info, (frame) => this.#send(frame));
    this.#kept.set(info.id, kept);
    void kept.exited.then(() => {
      if (this.#kept.get(info.id) === kept) this.#kept.delete(info.id);
      this.detachWhenIdle();
    });
    return kept;
  }

  /**
   * Holding nothing for this core: the socket goes, so the keeper, with no
   * core and nothing to hold, exits after `KEEPER_IDLE_MS`. The next spawn
   * attaches again, or starts another.
   */
  detachWhenIdle(): void {
    if (this.#stayAttached || this.#kept.size > 0 || this.#waiting.size > 0 || this.#connecting !== null || this.#frames === null) return;
    this.#frames.close();
    this.#frames = null;
  }

  async spawnTerminal(tag: KeptTag, cmd: string, args: string[], options: { cwd: string; env: Record<string, string | undefined>; cols: number; rows: number }): Promise<KeptTerminal> {
    await this.connect({ launch: true });
    if (!this.connected) throw new Error('the keeper is not reachable');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.env)) if (value !== undefined) env[key] = value;
    const req = this.#nextRequest++;
    const info = await new Promise<KeptProcess>((resolve, reject) => {
      const timer = setTimeout(() => { this.#waiting.delete(req); reject(new Error('the keeper did not start the process within five seconds')); }, ANSWER_MS);
      this.#waiting.set(req, { resolve, reject, timer });
      this.#send({ op: 'spawn', req, tag, cmd, args, cwd: options.cwd, env, cols: options.cols, rows: options.rows });
    });
    return this.adopt(info);
  }

  /**
   * Starts `cmd` on pipes in the keeper. Returns at once, as node's `spawn`
   * does: the child gets its pid and emits `spawn` when the keeper answers,
   * or `error` when it cannot be reached or cannot start it.
   */
  spawnPipe(tag: KeptTag, cmd: string, args: string[], options: { cwd: string; env: Record<string, string | undefined> }): KeptChild {
    const child = new KeptChild(tag, cmd, args);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.env)) if (value !== undefined) env[key] = value;
    const start = async (): Promise<void> => {
      await this.connect({ launch: true });
      // The connect under way was the startup one, which starts no keeper.
      if (!this.connected) await this.connect({ launch: true });
      if (!this.connected) throw new Error('the keeper is not reachable');
      const req = this.#nextRequest++;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.#waiting.delete(req); reject(new Error('the keeper did not start the process within five seconds')); }, ANSWER_MS);
        // Called in the `spawned` frame's own tick: the output after it on the socket finds the child.
        this.#waiting.set(req, {
          resolve: (info) => {
            this.#kept.set(info.id, child);
            child.started(info, this.#keeperPid, (frame) => this.#send(frame));
            resolve();
          },
          reject, timer,
        });
        this.#send({ op: 'spawnPipe', req, tag, cmd, args, cwd: options.cwd, env });
      });
    };
    void start().catch((error: unknown) => child.failed(error instanceof Error ? error : new Error(String(error))));
    child.once('close', () => {
      if (child.id !== null && this.#kept.get(child.id) === child) this.#kept.delete(child.id);
      this.detachWhenIdle();
    });
    return child;
  }

  /** What the keeper holds now, with each pipe's stdout window. */
  list(): Promise<KeptProcess[]> {
    if (!this.connected) return Promise.resolve([]);
    const req = this.#nextRequest++;
    return new Promise((resolve) => {
      this.#listing.set(req, resolve);
      this.#send({ op: 'list', req });
    });
  }

  /** The core stops: the socket goes, the processes stay with the keeper. */
  close(): void {
    this.#closed = true;
    this.#frames?.close();
    this.#frames = null;
    for (const waiting of this.#waiting.values()) { clearTimeout(waiting.timer); waiting.reject(new Error('the keeper client is closed')); }
    this.#waiting.clear();
    for (const answer of this.#listing.values()) answer([]);
    this.#listing.clear();
  }

  async #connect(launch: boolean): Promise<KeptProcess[] | null> {
    const token = keeperToken(this.#options.dataDir);
    let socket = await this.#open();
    if (socket === null) {
      if (!launch) return null;
      await (this.#options.launch ?? launchKeeper)(this.#options.dataDir, this.socketPath);
      const deadline = Date.now() + LAUNCH_MS;
      while (socket === null && Date.now() < deadline) {
        await Bun.sleep(LAUNCH_POLL_MS);
        socket = await this.#open();
      }
      if (socket === null) throw new Error(`the keeper did not listen on ${this.socketPath} within ${LAUNCH_MS / 1000} s`);
    }
    if (this.#closed) { socket.close(); return null; }
    this.#frames = socket;
    const answer = new Promise<KeptProcess[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the keeper did not answer hello within five seconds')), ANSWER_MS);
      this.#welcome = (processes) => { clearTimeout(timer); resolve(processes); };
      this.#refused = (message) => { clearTimeout(timer); reject(new Error(`the keeper refused this core: ${message}`)); };
    });
    socket.send({ op: 'hello', token, protocol: KEEPER_PROTOCOL, pid: process.pid, version: CORE_VERSION });
    try {
      const processes = await answer;
      this.#options.log('info', `keeper attached on ${this.socketPath}, holding ${processes.length} processes`);
      return processes;
    } catch (error) {
      socket.close();
      if (this.#frames === socket) this.#frames = null;
      throw error;
    } finally { this.#welcome = null; this.#refused = null; }
  }

  #open(): Promise<FrameSocket<ToKeeper> | null> {
    let frames: FrameSocket<ToKeeper> | null = null;
    const reader = new LineReader();
    return Bun.connect({
      unix: this.socketPath,
      socket: {
        open: (socket: Socket<undefined>) => {
          frames = new FrameSocket<ToKeeper>(socket as Socket<unknown>, KEEPER_PENDING_BYTES, () => this.#options.log('warn', 'the keeper stopped reading: its connection is dropped'));
        },
        data: (_socket: Socket<undefined>, bytes: Buffer) => {
          let lines: string[];
          try { lines = reader.push(bytes); } catch (error) { this.#options.log('warn', String(error)); frames?.close(); return; }
          for (const line of lines) {
            try { this.#receive(JSON.parse(line) as FromKeeper); } catch (error) { this.#options.log('warn', `unreadable keeper frame: ${String(error)}`); }
          }
        },
        drain: () => { frames?.drain(); },
        close: () => { frames?.gone(); if (this.#frames === frames) this.#lost(); },
        error: (_socket: Socket<undefined>, error: Error) => { this.#options.log('warn', `keeper socket: ${error.message}`); },
      },
    }).then(() => frames, () => null);
  }

  #receive(frame: FromKeeper): void {
    switch (frame.op) {
      case 'welcome': this.#keeperPid = frame.pid; this.#welcome?.(frame.processes); return;
      case 'refused': this.#refused?.(frame.message); return;
      case 'spawned': {
        const waiting = this.#waiting.get(frame.req);
        if (waiting === undefined) { this.#send({ op: 'release', id: frame.process.id }); return; }
        this.#waiting.delete(frame.req); clearTimeout(waiting.timer);
        waiting.resolve(frame.process);
        return;
      }
      case 'failed': {
        const waiting = this.#waiting.get(frame.req);
        if (waiting === undefined) return;
        this.#waiting.delete(frame.req); clearTimeout(waiting.timer);
        waiting.reject(new Error(frame.message));
        return;
      }
      case 'data': { const kept = this.#kept.get(frame.id); if (kept instanceof KeptTerminal) kept.data(decodeBytes(frame.data), frame.replay === true, frame.at); return; }
      case 'out': { const kept = this.#kept.get(frame.id); if (kept instanceof KeptChild) kept.output(frame.stream, frame.at, decodeBytes(frame.data)); return; }
      case 'eof': { const kept = this.#kept.get(frame.id); if (kept instanceof KeptChild) kept.eof(frame.stream); return; }
      case 'exit': {
        const kept = this.#kept.get(frame.id);
        if (kept instanceof KeptChild) kept.ended(frame.code, frame.signal ?? null);
        else kept?.ended(frame.code);
        return;
      }
      case 'listed': { const answer = this.#listing.get(frame.req); this.#listing.delete(frame.req); answer?.(frame.processes); return; }
      // Told to stop while this core is attached: the exits of what it ends follow, then the socket closes.
      case 'stopping': this.#options.log('warn', `the keeper stops: ${frame.reason}`); return;
    }
  }

  #send(frame: ToKeeper): void { this.#frames?.send(frame); }

  /**
   * The connection closed while this core was attached. The keeper may still
   * hold everything, having dropped a core that stopped reading: this core
   * attaches again and takes back what it lists, with the output it missed.
   * What it does not list, or a keeper that is gone, counts as ended.
   */
  #lost(): void {
    this.#frames = null;
    if (this.#closed) return;
    for (const waiting of this.#waiting.values()) { clearTimeout(waiting.timer); waiting.reject(new Error('the keeper connection was lost')); }
    this.#waiting.clear();
    for (const answer of this.#listing.values()) answer([]);
    this.#listing.clear();
    if (this.#kept.size > 0) void this.#reattach();
  }

  async #reattach(): Promise<void> {
    let held: KeptProcess[] | null = null;
    try { held = await this.connect({ launch: false }); } catch (error) {
      this.#options.log('warn', `the keeper on ${this.socketPath} did not answer again: ${error instanceof Error ? error.message : String(error)}`);
    }
    const listed = new Set((held ?? []).map((info) => info.id));
    let back = 0;
    for (const kept of [...this.#kept.values()]) {
      if (kept.id !== null && listed.has(kept.id)) { kept.attach(); back++; } else if (kept instanceof KeptChild) kept.ended(null, null, true); else kept.ended(null);
    }
    // Started for a request this core no longer waits for.
    for (const info of held ?? []) if (!this.#kept.has(info.id)) this.#send({ op: 'release', id: info.id });
    this.#options.log(held === null ? 'warn' : 'info', `the keeper connection on ${this.socketPath} was lost; ${back} kept processes attached again`);
    this.detachWhenIdle();
  }
}
