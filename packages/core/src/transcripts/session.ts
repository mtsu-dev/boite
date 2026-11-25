/*
 * One provider session into one archive file: `<session>.jsonl.zst`, the
 * records of `records.ts` under zstd. Runs in the journal's reader worker
 * (`artifact-retention-worker.ts`) since a session can be hundreds of
 * megabytes; it knows paths only, never the core.
 *
 * The archive is written beside its final name, read back whole and compared
 * by hash before it takes that name: a caller removes the provider's file only
 * after this resolves. Binary payloads go to the blob store once by the
 * SHA-256 of their bytes; a PNG or JPEG is stored as WebP when that is smaller.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { basename, dirname, join } from 'node:path';
import { constants, createZstdCompress, createZstdDecompress } from 'node:zlib';
import { ClaudeNormalizer } from './claude.ts';
import { CodexNormalizer } from './codex.ts';
import { capOutput, excerpt, object, sha256, type Json, type Sink, type TranscriptRecord } from './records.ts';

/** Who wrote a session: an agent's own transcript, or Boite's journal for an agent that keeps none Boite reads. */
export type TranscriptSource = 'claude' | 'codex';

export interface SessionJob {
  source: TranscriptSource;
  /** The session's file, then its subagents' files, each read whole in that order. */
  files: string[];
  /** Tool outputs Claude Code moved to files of their own (`<session>/tool-results/`). */
  toolResults?: string[];
  /** Where the archive goes; null measures without writing anything. */
  out: string | null;
  /** The blob store's directory; null with `out` null. */
  blobs: string | null;
  /** False once the thread's images are due to go: their references stay, their bytes are not stored. */
  keepBlobs: boolean;
}

/** A failure the index lists: a failed tool, an API error, a harness error. */
export interface TranscriptFailure {
  line: number;
  at: number | null;
  kind: string;
  tool: string | null;
  text: string;
}

export interface StoredBlob {
  sha256: string;
  /** Bytes as the session held it, and as stored. */
  bytes: number;
  stored: number;
  mime: string;
  ext: string;
}

export interface SessionResult {
  /** Bytes of the provider's files read. */
  rawBytes: number;
  /** Bytes of the archive, and of the records before compression. */
  bytes: number;
  recordBytes: number;
  records: number;
  /** Hash of the records before compression: what a later check compares. */
  sha256: string;
  firstAt: number | null;
  lastAt: number | null;
  models: string[];
  failures: TranscriptFailure[];
  /** Blobs the session refers to, each once. */
  blobs: StoredBlob[];
  /** Source bytes by what became of them. */
  counts: { [key: string]: number };
}

/** zstd as high as stays quick to read back; a 16 MiB window reaches the context a long session repeats. */
const ZSTD = { [constants.ZSTD_c_compressionLevel]: 19, [constants.ZSTD_c_windowLog]: 24, [constants.ZSTD_c_enableLongDistanceMatching]: 1 };
/** A provider's own `.zst` rollout may use a long window. */
const UNZSTD = { [constants.ZSTD_d_windowLogMax]: 31 };
/** Failures listed a session; past it the archive still holds them all. */
const FAILURES_MAX = 2000;
const WEBP_QUALITY = 80;

const MAGIC: { mime: string; ext: string; test: (bytes: Uint8Array) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', ext: 'jpg', test: b => b[0] === 0xff && b[1] === 0xd8 },
  { mime: 'image/webp', ext: 'webp', test: b => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { mime: 'image/gif', ext: 'gif', test: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'application/pdf', ext: 'pdf', test: b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
];

/** Where a blob is filed: two levels keep a directory short. */
export function blobPath(dir: string, sha: string, ext: string): string {
  return join(dir, sha.slice(0, 2), `${sha}.${ext}`);
}

/** A file as a stream, through zstd when its name says so. A read error ends the stream it feeds. */
function opened(path: string, zstd = path.endsWith('.zst')): AsyncIterable<Buffer> {
  const file = createReadStream(path, { highWaterMark: 1 << 20 });
  if (!zstd) return file as AsyncIterable<Buffer>;
  const plain = createZstdDecompress({ params: UNZSTD });
  file.once('error', error => plain.destroy(error));
  plain.once('close', () => file.destroy());
  return file.pipe(plain) as AsyncIterable<Buffer>;
}

/** The lines of a session file or of an archive, empty ones left out. */
export async function* lines(path: string): AsyncGenerator<string> {
  const source = opened(path);
  let parts: Buffer[] = [];
  for await (const chunk of source) {
    let start = 0;
    for (;;) {
      const at = chunk.indexOf(10, start);
      if (at < 0) break;
      parts.push(chunk.subarray(start, at));
      const line = parts.length === 1 ? parts[0]!.toString('utf8') : Buffer.concat(parts).toString('utf8');
      parts = [];
      start = at + 1;
      if (line.length > 0) yield line;
    }
    // Copied: the stream reuses nothing, but a subarray would pin the whole chunk.
    if (start < chunk.length) parts.push(Buffer.from(chunk.subarray(start)));
  }
  if (parts.length > 0) {
    const line = Buffer.concat(parts).toString('utf8');
    if (line.length > 0) yield line;
  }
}

/** A PNG or JPEG as WebP when that is smaller; anything else, and any failure, as it came. */
async function shrink(data: Buffer, kind: { mime: string; ext: string }): Promise<{ data: Uint8Array; ext: string }> {
  if ((kind.ext !== 'png' && kind.ext !== 'jpg') || typeof Bun.Image !== 'function') return { data, ext: kind.ext };
  try {
    const webp = await new Bun.Image(data).webp({ quality: WEBP_QUALITY }).bytes();
    return webp.length < data.length ? { data: webp, ext: 'webp' } : { data, ext: kind.ext };
  } catch {
    return { data, ext: kind.ext };
  }
}

async function hashOf(path: string): Promise<{ sha256: string; lines: number }> {
  const hasher = new Bun.CryptoHasher('sha256');
  let count = 0;
  for await (const chunk of opened(path, true)) {
    hasher.update(chunk);
    for (let at = chunk.indexOf(10); at >= 0; at = chunk.indexOf(10, at + 1)) count += 1;
  }
  return { sha256: hasher.digest('hex'), lines: count };
}

const timeOf = (value: Json | undefined): number | null => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
};

/** Whether a record is a failure the index lists, and under what name. */
function failureOf(entry: TranscriptRecord): string | null {
  if (entry.k === 'result' && (entry.error === true || (typeof entry.exit === 'number' && entry.exit !== 0))) return 'tool';
  if (entry.k === 'turn' && typeof entry.error === 'string') return 'turn';
  if (entry.k === 'item' && entry.failed === true) return 'item';
  if (entry.k === 'usage' && (entry.api_error === true || entry.error !== undefined)) return 'api';
  if (entry.k === 'event' && (entry.type === 'error' || entry.type === 'stream_error' || entry.type === 'turn_aborted')) return String(entry.type);
  if (entry.k === 'system' && (entry.level === 'error' || entry.subtype === 'api_error')) return 'system';
  return null;
}

function failureText(entry: TranscriptRecord): string {
  if (entry.k === 'result') return excerpt(entry.out);
  if (entry.k === 'item') return excerpt(entry.aggregated_output ?? entry.stderr ?? entry.error ?? entry.output ?? entry.status);
  if (entry.k === 'usage') return excerpt(entry.error ?? 'API error');
  if (entry.k === 'turn') return excerpt(entry.error);
  if (entry.k === 'system') return excerpt(entry.content ?? entry.error ?? entry.cause);
  return excerpt(entry.message ?? entry.reason ?? entry.type);
}

/** What an archive holds once written, whatever fed it. */
export type ArchiveResult = Omit<SessionResult, 'rawBytes'>;

/**
 * Writes records to an archive: `emit` each, `flush` between source lines so
 * the compressor and the blob store keep up, then `finish`, which reads the
 * file back before it takes its name. `abort` leaves nothing behind.
 */
export class ArchiveWriter {
  readonly counts: { [key: string]: number } = {};
  readonly sink: Sink;
  readonly #blobs = new Map<string, StoredBlob>();
  #pending: { sha: string; data: Buffer; kind: { mime: string; ext: string } }[] = [];
  readonly #temp: string | null;
  readonly #zstd = createZstdCompress({ params: ZSTD });
  #file: ReturnType<typeof createWriteStream> | null = null;
  #closed: Promise<unknown> | null = null;
  readonly #failed: Promise<never>;
  readonly #hasher = new Bun.CryptoHasher('sha256');
  readonly #failures: TranscriptFailure[] = [];
  readonly #models = new Set<string>();
  readonly #tools = new Map<string, string>();
  #batch: string[] = [];
  #bytes = 0;
  #records = 0;
  #recordBytes = 0;
  #firstAt: number | null = null;
  #lastAt: number | null = null;

  constructor(private readonly out: string | null, private readonly blobsDir: string | null, keepBlobs: boolean) {
    this.#temp = out === null ? null : `${out}.partial`;
    this.#failed = new Promise<never>((_, reject) => { this.#zstd.once('error', reject); });
    this.#failed.catch(() => undefined);
    const counts = this.counts;
    const blobs = this.#blobs;
    const queue = (item: { sha: string; data: Buffer; kind: { mime: string; ext: string } }): void => { this.#pending.push(item); };
    this.sink = {
      count(key, bytes) { counts[key] = (counts[key] ?? 0) + bytes; },
      blob(base64, mime) {
        const data = Buffer.from(base64, 'base64');
        const sha = sha256(data);
        const kind = MAGIC.find(magic => magic.test(data)) ?? { mime: mime ?? 'application/octet-stream', ext: 'bin' };
        counts['blob in'] = (counts['blob in'] ?? 0) + base64.length;
        if (!blobs.has(sha)) {
          blobs.set(sha, { sha256: sha, bytes: data.length, stored: 0, mime: kind.mime, ext: kind.ext });
          // The delay on images is on images: a PDF or any other binary is always stored.
          if (keepBlobs || !kind.mime.startsWith('image/')) queue({ sha, data, kind });
        }
        return { $blob: sha, bytes: data.length, mime: kind.mime };
      },
    };
  }

  readonly emit = (entry: TranscriptRecord): void => {
    this.#records += 1;
    const at = timeOf(entry.t);
    if (at !== null) { this.#firstAt ??= at; this.#lastAt = at; }
    if (entry.k === 'call' && typeof entry.call === 'string' && typeof entry.tool === 'string') this.#tools.set(entry.call, entry.tool);
    if (entry.k === 'usage' && typeof entry.model === 'string') this.#models.add(entry.model);
    if (entry.k === 'context' && object(entry.data) && typeof entry.data.model === 'string') this.#models.add(entry.data.model);
    const failure = failureOf(entry);
    if (failure !== null && this.#failures.length < FAILURES_MAX) {
      const tool = entry.k === 'result' && typeof entry.call === 'string' ? this.#tools.get(entry.call) ?? null : typeof entry.tool === 'string' ? entry.tool : typeof entry.type === 'string' ? entry.type : null;
      this.#failures.push({ line: this.#records, at: at ?? this.#lastAt, kind: failure, tool, text: failureText(entry) });
    }
    this.#batch.push(JSON.stringify(entry));
  };

  /** Opened at the first write: an aborted job that wrote nothing makes no file. */
  async #open(): Promise<void> {
    if (this.#closed !== null) return;
    if (this.#temp === null) {
      // A measure counts what the compressor gives and writes none of it.
      this.#zstd.on('data', (chunk: Buffer) => { this.#bytes += chunk.length; });
      this.#closed = once(this.#zstd, 'end');
      return;
    }
    await mkdir(dirname(this.#temp), { recursive: true });
    const file = createWriteStream(this.#temp);
    file.once('error', error => this.#zstd.destroy(error));
    this.#zstd.pipe(file);
    this.#file = file;
    this.#closed = once(file, 'close');
  }

  async flush(): Promise<void> {
    await this.#open();
    if (this.#batch.length > 0) {
      const chunk = Buffer.from(`${this.#batch.join('\n')}\n`, 'utf8');
      this.#batch = [];
      this.#recordBytes += chunk.length;
      this.#hasher.update(chunk);
      if (!this.#zstd.write(chunk)) await Promise.race([once(this.#zstd, 'drain'), this.#failed]);
    }
    const queue = this.#pending;
    this.#pending = [];
    for (const { sha, data, kind } of queue) {
      const blob = this.#blobs.get(sha)!;
      const dir = this.blobsDir;
      const shrunk = await shrink(data, kind);
      blob.stored = shrunk.data.length;
      blob.ext = shrunk.ext;
      if (dir === null) continue;
      const target = blobPath(dir, sha, shrunk.ext);
      // The store may hold it already: kept only when it is these very bytes, written again when it is not.
      const held = await readFile(target).catch(() => null);
      if (held !== null && held.equals(shrunk.data)) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(`${target}.partial`, shrunk.data);
      await rename(`${target}.partial`, target);
    }
  }

  async finish(): Promise<ArchiveResult> {
    await this.flush();
    this.#zstd.end();
    await Promise.race([this.#closed, this.#failed]);
    const digest = this.#hasher.digest('hex');
    if (this.#temp !== null && this.out !== null) {
      const check = await hashOf(this.#temp);
      if (check.sha256 !== digest || check.lines !== this.#records) throw new Error(`${this.#temp} reads back as ${check.lines} records (${check.sha256}), ${this.#records} were written (${digest})`);
      this.#bytes = (await stat(this.#temp)).size;
      await rename(this.#temp, this.out);
    }
    return {
      bytes: this.#bytes, recordBytes: this.#recordBytes, records: this.#records, sha256: digest, firstAt: this.#firstAt, lastAt: this.#lastAt,
      models: [...this.#models], failures: this.#failures, blobs: [...this.#blobs.values()], counts: this.counts,
    };
  }

  async abort(): Promise<void> {
    this.#zstd.destroy();
    this.#file?.destroy();
    if (this.#temp !== null) await rm(this.#temp, { force: true });
  }
}

export async function compactSession(job: SessionJob): Promise<SessionResult> {
  const writer = new ArchiveWriter(job.out, job.blobs, job.keepBlobs);
  let rawBytes = 0;
  try {
    for (const [index, path] of job.files.entries()) {
      rawBytes += (await stat(path)).size;
      // A subagent's file opens with a marker: its lines are a conversation of their own.
      if (index > 0) writer.emit({ k: 'file', name: basename(path) });
      const normalizer = job.source === 'claude' ? new ClaudeNormalizer(writer.sink, writer.emit) : new CodexNormalizer(writer.sink, writer.emit);
      for await (const line of lines(path)) {
        normalizer.line(line);
        await writer.flush();
      }
      normalizer.end();
    }
    for (const path of job.toolResults ?? []) {
      const text = await Bun.file(path).text();
      rawBytes += Buffer.byteLength(text);
      writer.emit({ k: 'result-file', name: basename(path), out: capOutput(text, false, writer.sink) });
      await writer.flush();
    }
    return { rawBytes, ...(await writer.finish()) };
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

/** Reads an archive's records in order; `take` returning false stops the read. */
export async function readArchive(path: string, take: (entry: TranscriptRecord, line: number) => boolean | void): Promise<void> {
  let index = 0;
  for await (const line of lines(path)) {
    index += 1;
    let entry: TranscriptRecord;
    try { entry = JSON.parse(line) as TranscriptRecord; } catch { continue; }
    if (take(entry, index) === false) return;
  }
}
