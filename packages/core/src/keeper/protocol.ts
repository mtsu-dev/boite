/*
 * The wire between a core and its keeper: one JSON object per line over a Unix
 * socket. The keeper (`keeper/server.ts`) holds the processes a core asked it
 * to start, so they outlive that core; the next core attaches to them again
 * (`keeper/client.ts`). Process output travels base64 encoded, since a PTY
 * writes bytes that are not always whole UTF-8.
 *
 * `hello`, `welcome`, `signal` and `release` never change shape: any core can
 * list and end what a keeper of another version holds.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

/** Bumped by a change a keeper already running could not understand. */
export const KEEPER_PROTOCOL = 1;

/** What the keeper keeps of a PTY's output for the next core, as the core's own history does. */
export const KEEPER_PTY_HISTORY_BYTES = 256 * 1024;

/**
 * How long a keeper with live processes waits for a core before it ends them.
 * A service restarts its core within seconds; past this nobody is coming back.
 */
export const KEEPER_ORPHAN_MS = 10 * 60_000;

/** How long a keeper with nothing to hold stays up before it exits. */
export const KEEPER_IDLE_MS = 60_000;

/** A core that opened the socket has this long to say `hello`. */
export const KEEPER_HELLO_MS = 5_000;

/**
 * Output waiting for a core whose socket does not drain. Past it the keeper
 * drops that connection instead of growing without bound; the process and its
 * history stay for the next attachment.
 */
export const KEEPER_PENDING_BYTES = 16 * 1024 * 1024;

/** The core's own description of a process, which the keeper stores without reading. */
export type KeptTag = Record<string, unknown>;

export interface KeptProcess {
  id: string;
  pid: number;
  tag: KeptTag;
  /** Wall time the keeper started it. */
  startedAt: number;
  /** Null while it runs. */
  exit: { code: number | null; at: number } | null;
}

export type ToKeeper =
  | { op: 'hello'; token: string; protocol: number; pid: number; version: string }
  | { op: 'spawn'; req: number; tag: KeptTag; cmd: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }
  /**
   * Sends the history first, as one `data` frame marked `replay`, then the
   * live output. A core that already had the first `from` bytes gets only
   * what came after them, or the whole history when more than it holds.
   */
  | { op: 'attach'; id: string; from?: number }
  | { op: 'write'; id: string; data: string }
  | { op: 'resize'; id: string; cols: number; rows: number }
  | { op: 'signal'; id: string; signal: KeeperSignal }
  /** The core is done with it: ended if it runs, forgotten either way. */
  | { op: 'release'; id: string };

export type FromKeeper =
  | { op: 'welcome'; protocol: number; version: string; pid: number; processes: KeptProcess[] }
  | { op: 'refused'; message: string }
  | { op: 'spawned'; req: number; process: KeptProcess }
  | { op: 'failed'; req: number; message: string }
  /** `at`, on a replay: how many bytes the process printed up to its end. */
  | { op: 'data'; id: string; data: string; replay?: true; at?: number }
  | { op: 'exit'; id: string; code: number | null }
  /** The keeper exits: idle, orphaned or told to. What it still held ends with it. */
  | { op: 'stopping'; reason: string };

export type KeeperSignal = 'SIGHUP' | 'SIGTERM' | 'SIGKILL';
export const KEEPER_SIGNALS: readonly KeeperSignal[] = ['SIGHUP', 'SIGTERM', 'SIGKILL'];

/**
 * Where the keeper of `dataDir` listens. `sun_path` holds 108 bytes on Linux
 * and 104 on macOS, which a data directory deep in a home can pass, so the
 * socket lives in the runtime directory under a hash of the data directory.
 * The protocol is in the name: a core never talks to a keeper it cannot read.
 */
export function keeperSocketPath(dataDir: string, env: Record<string, string | undefined> = process.env): string {
  let real = dataDir;
  try { real = realpathSync(dataDir); } catch { /* not created yet: the path as given */ }
  const hash = createHash('sha256').update(real).digest('hex').slice(0, 12);
  return join(keeperRuntimeDir(env), `keeper-${hash}-v${KEEPER_PROTOCOL}.sock`);
}

/** `$XDG_RUNTIME_DIR/boite`, else a directory of this user's under the system's temporary one. */
export function keeperRuntimeDir(env: Record<string, string | undefined> = process.env): string {
  const runtime = env['XDG_RUNTIME_DIR'];
  if (runtime !== undefined && runtime.startsWith('/')) return join(runtime, 'boite');
  return join(tmpdir(), `boite-${userInfo().uid}`);
}

/** Where the token the keeper and its core share is kept: beside the journal, owner only. */
export function keeperTokenPath(dataDir: string): string {
  return join(dataDir, 'keeper.json');
}

/**
 * Splits a byte stream into lines. A frame cut between two reads waits for its
 * end; a line longer than `max`, whole or not, is refused rather than buffered forever.
 */
export class LineReader {
  #held = '';
  readonly #decoder = new TextDecoder();

  constructor(private readonly max = 64 * 1024 * 1024) {}

  push(chunk: Uint8Array): string[] {
    this.#held += this.#decoder.decode(chunk, { stream: true });
    const lines = this.#held.split('\n');
    this.#held = lines.pop() ?? '';
    if (this.#held.length > this.max || lines.some((line) => line.length > this.max)) throw new Error(`a keeper frame passed ${this.max} bytes without a line break`);
    return lines.filter((line) => line.length > 0);
  }
}

export function encodeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function decodeBytes(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'));
}
