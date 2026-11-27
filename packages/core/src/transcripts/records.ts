/*
 * The one format every transcript is kept in once it is compacted: a stream of
 * JSON records, one a line, in the order the provider wrote them, each with its
 * time. Whatever agent wrote the session, an audit reads the same kinds:
 *
 *   user, assistant, reasoning   what was said, whole
 *   call, result                 a tool call with its whole input, and its output
 *   usage, request               tokens and model of a response, the request settings
 *   system, context, event       what the harness told the model or reported
 *   item                         a Codex item: a command, a file change, an MCP call
 *   queue, summary, wire, other  the rest, kept so nothing is silently lost
 *
 * Messages, reasoning, tool inputs, errors and non-zero exits are never cut.
 * A tool output past the cap keeps its head, its tail and its error lines with
 * its size and hash (`capOutput`). A binary payload leaves the stream for the
 * blob store and stays as `{ $blob, bytes, mime }` (`Sink.blob`).
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Obj = { [key: string]: Json };

/** A record of the stream. `k` is its kind, `t` its time as the provider wrote it. */
export type TranscriptRecord = Obj & { k: string };

/** Bytes of a successful tool output kept, and of a failed one. */
export const OUTPUT_CAP = 16_384;
export const FAILED_OUTPUT_CAP = 65_536;
const HEAD = 8192;
const TAIL = 6144;
const ERROR_LINES = 2048;
const ERROR_LINE_MAX = 400;

/** What an error line looks like in a tool's output. */
const ERROR_LINE = /\b(error|fail(ed|ure)?|panic|exception|traceback|fatal|denied|refused|timed? ?out|exit (code|status) [1-9]|not found|cannot|unable)\b/i;

/** How a base64 payload starts: long, one unbroken run of the alphabet. */
const BASE64_HEAD = /^[A-Za-z0-9+/\r\n]{1024,}={0,2}$/;
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/;
const BLOB_MIN = 1024;

export interface Sink {
  /** Takes a base64 payload out of the stream and answers the reference that replaces it. */
  blob(base64: string, mime: string | null): Obj;
  /** Bytes of the source by what became of them, for the report. */
  count(key: string, bytes: number): void;
}

export const object = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
export const bytesOf = (text: string): number => Buffer.byteLength(text, 'utf8');

export function sha256(data: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(data).digest('hex');
}

/** The payload of a base64 text, when it decodes and encodes back to the same characters: nothing is lost by filing it. */
function exact(base64: string): boolean {
  const clean = base64.includes('\n') ? base64.replace(/[\r\n]/g, '') : base64;
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return false;
  return Buffer.from(clean, 'base64').toString('base64') === clean;
}

/** A data URL whose payload is exact base64. An image is one at any size: its delay must reach it. */
function dataUrl(text: string): RegExpExecArray | null {
  const url = DATA_URL.exec(text.slice(0, 80));
  if (url === null || (text.length < BLOB_MIN && !url[1]!.startsWith('image/'))) return null;
  return text.length > url[0].length && exact(text.slice(url[0].length)) ? url : null;
}

/** A bare string that is a base64 payload from its first character to its last. */
function isBlob(text: string): boolean {
  if (dataUrl(text) !== null) return true;
  if (text.length < BLOB_MIN) return false;
  const head = text.slice(0, 4096);
  if (!BASE64_HEAD.test(head)) return false;
  // Plain words on short lines use the same alphabet: an encoder wraps at 64
  // characters or more, and its output mixes cases and digits.
  const lines = head.split(/\r?\n/);
  if (lines.slice(0, -1).some(line => line.length < 64)) return false;
  return /[A-Z]/.test(head) && /[a-z]/.test(head) && /[0-9]/.test(head) && exact(text);
}

function blobOf(text: string, mime: string | null, sink: Sink): Obj {
  const url = DATA_URL.exec(text.slice(0, 80));
  return sink.blob(url ? text.slice(url[0].length) : text, mime ?? url?.[1] ?? null);
}

/**
 * Every base64 payload of a value becomes a reference to the blob store: an
 * image or document part, a data URL, and with `bare` a string that is base64
 * and nothing else. A tool's input passes `bare` false: only what names itself
 * a binary leaves it.
 */
export function stripBlobs(value: Json | undefined, sink: Sink, bare = true): Json {
  if (value === undefined) return null;
  if (typeof value === 'string') return (bare ? isBlob(value) : dataUrl(value) !== null) ? blobOf(value, null, sink) : value;
  if (Array.isArray(value)) return value.map(item => stripBlobs(item, sink, bare));
  if (!object(value)) return value;
  const source = value.source;
  if ((value.type === 'image' || value.type === 'document') && object(source) && typeof source.data === 'string' && exact(source.data)) {
    return blobOf(source.data, typeof source.media_type === 'string' ? source.media_type : null, sink);
  }
  const out: Obj = {};
  for (const [key, item] of Object.entries(value)) out[key] = stripBlobs(item, sink, bare);
  return out;
}

/** The nearest start of a character at or before (`step` -1) or after (`step` 1) byte `at`. */
function boundary(raw: Buffer, at: number, step: 1 | -1): number {
  let index = Math.min(Math.max(0, at), raw.length);
  while (index > 0 && index < raw.length && (raw[index]! & 0xc0) === 0x80) index += step;
  return index;
}

/**
 * A tool output under the cap, whole; past it, its head, the error lines of
 * its middle and its tail, with the size and hash of the original. A failed
 * tool keeps four times as much.
 */
export function capOutput(text: string, failed: boolean, sink: Sink): Json {
  const bytes = bytesOf(text);
  sink.count('tool output in', bytes);
  const limit = failed ? FAILED_OUTPUT_CAP : OUTPUT_CAP;
  if (bytes <= limit) {
    sink.count('tool output kept', bytes);
    return text;
  }
  // Counted in bytes, cut between characters: head, error lines and tail never pass the limit together.
  const scale = limit / OUTPUT_CAP;
  const raw = Buffer.from(text, 'utf8');
  const headEnd = boundary(raw, HEAD * scale, -1);
  const tailStart = Math.max(headEnd, boundary(raw, raw.length - TAIL * scale, 1));
  const head = raw.toString('utf8', 0, headEnd);
  const tail = raw.toString('utf8', tailStart);
  const errors: string[] = [];
  let left = ERROR_LINES * scale;
  for (const line of raw.toString('utf8', headEnd, tailStart).split('\n')) {
    if (left <= 0) break;
    if (!ERROR_LINE.test(line.slice(0, ERROR_LINE_MAX * scale))) continue;
    const bytes = Buffer.from(line, 'utf8');
    const cut = bytes.toString('utf8', 0, boundary(bytes, Math.min(ERROR_LINE_MAX * scale, left), -1));
    errors.push(cut);
    left -= bytesOf(cut) + 1;
  }
  sink.count('tool output kept', bytesOf(head) + bytesOf(tail) + errors.reduce((sum, line) => sum + bytesOf(line), 0));
  sink.count('tool outputs cut', 1);
  return { head, errors, tail, bytes, sha256: sha256(text) };
}

/** A tool result's content: its text capped, its images referenced. */
export function capContent(content: Json | undefined, failed: boolean, sink: Sink): Json {
  if (typeof content === 'string') return isBlob(content) ? blobOf(content, null, sink) : capOutput(content, failed, sink);
  if (!Array.isArray(content)) return stripBlobs(content, sink);
  const out = content.map(item => object(item) && typeof item.text === 'string'
    ? (isBlob(item.text) ? blobOf(item.text, null, sink) : capOutput(item.text, failed, sink))
    : stripBlobs(item, sink));
  return out.length === 1 ? out[0]! : out;
}

/** The numbers, flags and short strings of a structure whose long texts the stream already holds. */
export function scalars(value: Json | undefined, limit = 256): Obj | null {
  if (!object(value)) return null;
  const out: Obj = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item === 'number' || typeof item === 'boolean') out[key] = item;
    else if (typeof item === 'string') { if (item.length <= limit) out[key] = item; }
    else if (object(item)) {
      const inner = scalars(item, limit);
      if (inner !== null && Object.keys(inner).length > 0) out[key] = inner;
    }
  }
  return out;
}

/** A record without its null and undefined fields. */
export function record(fields: { [key: string]: Json | undefined } & { k: string }): TranscriptRecord {
  const out: Obj = {};
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null) out[key] = value;
  return out as TranscriptRecord;
}

/** What a failed record says in the index: its first lines, short. */
export function excerpt(value: Json | undefined, max = 400): string {
  const text = typeof value === 'string' ? value
    : object(value) && typeof value.head === 'string' ? (Array.isArray(value.errors) && value.errors.length > 0 ? value.errors.join('\n') : typeof value.tail === 'string' ? value.tail : value.head)
    : value === undefined || value === null ? '' : JSON.stringify(value);
  return text.trim().slice(0, max);
}
