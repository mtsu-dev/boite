/*
 * A Claude Code transcript (`<session>.jsonl`) into the records of
 * `records.ts`. What goes: the second copy of every tool result
 * (`toolUseResult`, whose numbers and flags stay as `info`), the copies of
 * messages as sent on the wire, request telemetry, reasoning signatures and
 * the bookkeeping lines the CLI rewrites all along a session.
 */

import { capContent, object, record, scalars, sha256, stripBlobs, type Json, type Obj, type Sink, type TranscriptRecord } from './records.ts';

type Emit = (record: TranscriptRecord) => void;

/** Fields of a system line worth an audit; the rest repeats the envelope. */
const SYSTEM_FIELDS = ['subtype', 'level', 'error', 'content', 'retryAttempt', 'retryInMs', 'maxRetries', 'source', 'compactMetadata', 'durationMs', 'hookInfos', 'stopReason', 'toolUseID', 'cause'];
/** Envelope fields said once, then again only when they change. */
const STATE_FIELDS = ['cwd', 'gitBranch', 'version', 'permissionMode'];
/** Lines the CLI rewrites as it goes, whose last word says it all. */
const LATEST_ONLY = new Set(['ai-title', 'custom-title', 'mode', 'agent-name', 'tag']);
const BOOKKEEPING = new Set(['last-prompt', 'atis-latch', 'tools-used']);

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const short = (value: Json | undefined): string | undefined => typeof value === 'string' && value.length > 0 ? value.slice(0, 8) : undefined;

export class ClaudeNormalizer {
  /** Texts and tool ids already in the stream: a wire copy of them is dropped. */
  readonly #texts = new Set<string>();
  readonly #tools = new Set<string>();
  readonly #usages = new Set<string>();
  readonly #state = new Map<string, string>();
  #previous: string | null = null;
  #cost: Obj | null = null;

  constructor(private readonly sink: Sink, private readonly emit: Emit) {}

  #said(value: string): string {
    this.#texts.add(sha256(value));
    return value;
  }

  line(line: string): void {
    const bytes = Buffer.byteLength(line);
    let entry: Json;
    try { entry = JSON.parse(line) as Json; } catch { entry = null; }
    if (!object(entry)) {
      this.sink.count('unparsed', bytes);
      this.emit({ k: 'raw', text: line.slice(0, 2048) });
      return;
    }
    const type = text(entry.type) || '?';
    this.sink.count(`in:${type}`, bytes);
    const base: { [key: string]: Json | undefined } = { t: entry.timestamp };
    const id = text(entry.uuid);
    if (id) base.id = short(id);
    const parent = text(entry.parentUuid);
    if (parent && parent !== this.#previous) base.parent = short(parent);
    if (id) this.#previous = id;
    if (entry.isSidechain === true) base.side = typeof entry.agentId === 'string' ? entry.agentId : true;
    for (const key of STATE_FIELDS) {
      const value = entry[key];
      if (typeof value !== 'string' || this.#state.get(key) === value) continue;
      this.#state.set(key, value);
      base[key] = value;
    }
    const message = entry.message;
    if (type === 'assistant' && object(message)) this.#assistant(entry, message, base);
    else if (type === 'user' && object(message)) this.#user(entry, message, base);
    else if (type === 'system') {
      const out: { [key: string]: Json | undefined } & { k: string } = { ...base, k: 'system' };
      for (const key of SYSTEM_FIELDS) if (entry[key] !== undefined) out[key] = stripBlobs(entry[key], this.sink);
      this.emit(record(out));
    } else if (type === 'attachment') {
      const attachment = entry.attachment;
      this.emit(record({ ...base, k: 'context', what: object(attachment) ? attachment.type : undefined, rendered: stripBlobs(entry.rendered, this.sink), attachment: stripBlobs(attachment, this.sink) }));
    } else if (type === 'api-request-shape') {
      // The CLI writes a shape again in every session file that uses it; once is enough here.
      const hash = text(entry.shapeHash);
      if (hash && this.#state.get(`shape:${hash}`) !== undefined) this.sink.count('dropped: repeated request shape', bytes);
      else {
        this.#state.set(`shape:${hash}`, '1');
        this.emit(record({ t: entry.timestamp, k: 'request-shape', hash: entry.shapeHash, shape: entry.shape }));
      }
    } else if (type === 'api-request') {
      const params = object(entry.params) ? entry.params : {};
      const request = record({ k: 'request', model: params.model, effort: object(params.output_config) ? params.output_config.effort : undefined, speed: params.speed, shape: entry.shapeHash, source: entry.querySource });
      this.sink.count('dropped: request telemetry', bytes);
      const key = JSON.stringify(request);
      if (this.#state.get('request') !== key) {
        this.#state.set('request', key);
        this.emit(record({ t: entry.timestamp, ...request }));
      }
    } else if (type === 'api-request-blob') this.#wire(entry, bytes);
    else if (type === 'queue-operation') {
      this.emit(record({ t: entry.timestamp, k: 'queue', op: entry.operation, text: entry.content ? stripBlobs(entry.content, this.sink) : undefined }));
    } else if (LATEST_ONLY.has(type)) {
      // What names the line (its id, its parent, its time) is new each time: the value alone says whether it changed.
      const { type: _type, sessionId: _session, timestamp, uuid: _uuid, parentUuid: _parent, ...rest } = entry;
      const key = JSON.stringify(rest);
      if (this.#state.get(type) !== key) {
        this.#state.set(type, key);
        this.emit(record({ t: timestamp, ...rest, k: type }));
      }
    } else if (BOOKKEEPING.has(type)) this.sink.count('dropped: bookkeeping', bytes);
    else if (type === 'cost-state') {
      const { type: _type, sessionId: _session, ...rest } = entry;
      this.#cost = rest;
    } else if (type === 'summary') {
      this.emit(record({ k: 'summary', text: entry.summary, leaf: short(entry.leafUuid) }));
    } else if (type === 'file-history-snapshot') {
      const snapshot = object(entry.snapshot) && object(entry.snapshot.trackedFileBackups) ? Object.keys(entry.snapshot.trackedFileBackups) : [];
      this.emit(record({ k: 'file-snapshot', id: short(entry.messageId), files: snapshot }));
    } else {
      const { type: _type, sessionId: _session, ...rest } = entry;
      this.emit({ k: 'other', type, data: stripBlobs(rest, this.sink) });
    }
  }

  /** The session's last cost line, said once at the end. */
  end(): void {
    if (this.#cost !== null) this.emit(record({ ...this.#cost, k: 'cost' }));
    this.#cost = null;
  }

  #assistant(entry: Obj, message: Obj, base: { [key: string]: Json | undefined }): void {
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (!object(part)) continue;
      if (part.type === 'text') this.emit(record({ ...base, k: 'assistant', text: this.#said(text(part.text)) }));
      else if (part.type === 'thinking' || part.type === 'redacted_thinking') {
        this.sink.count('dropped: reasoning signature', text(part.signature).length + text(part.data).length);
        this.emit(record({ ...base, k: 'reasoning', text: this.#said(text(part.thinking)), sealed: part.type === 'redacted_thinking' ? true : undefined }));
      } else if (part.type === 'tool_use' || part.type === 'server_tool_use') {
        this.#tools.add(`call:${text(part.id)}`);
        this.emit(record({ ...base, k: 'call', call: part.id, tool: part.name, input: stripBlobs(part.input, this.sink, false) }));
      } else this.emit(record({ ...base, k: 'assistant', part: stripBlobs(part, this.sink) }));
    }
    // A response is written as one line a content block: its usage is said once.
    const response = text(message.id) || text(entry.uuid);
    if (this.#usages.has(response)) return;
    this.#usages.add(response);
    const usage = object(message.usage) ? message.usage : {};
    this.emit(record({
      t: base.t, k: 'usage', model: message.model, stop: message.stop_reason,
      in: usage.input_tokens, out: usage.output_tokens, cache_read: usage.cache_read_input_tokens, cache_write: usage.cache_creation_input_tokens,
      tier: usage.service_tier, speed: usage.speed,
      error: entry.error ? entry.error : undefined, api_error: entry.isApiErrorMessage === true ? true : undefined,
    }));
  }

  #user(entry: Obj, message: Obj, base: { [key: string]: Json | undefined }): void {
    if ('toolUseResult' in entry) this.sink.count('dropped: duplicate tool result', Buffer.byteLength(JSON.stringify(entry.toolUseResult ?? null)));
    const info = scalars(entry.toolUseResult);
    const content = message.content;
    if (typeof content === 'string') {
      this.emit(record({ ...base, k: 'user', text: this.#said(content), meta: entry.isMeta === true ? true : undefined }));
      return;
    }
    for (const part of Array.isArray(content) ? content : []) {
      if (!object(part)) continue;
      if (part.type === 'tool_result') {
        const failed = part.is_error === true;
        this.#tools.add(`result:${text(part.tool_use_id)}`);
        this.emit(record({
          ...base, k: 'result', call: part.tool_use_id, out: capContent(part.content, failed, this.sink),
          error: failed ? true : undefined, info: info !== null && Object.keys(info).length > 0 ? info : undefined,
        }));
      } else if (part.type === 'text') this.emit(record({ ...base, k: 'user', text: this.#said(text(part.text)), meta: entry.isMeta === true ? true : undefined }));
      else this.emit(record({ ...base, k: 'user', part: stripBlobs(part, this.sink) }));
    }
  }

  /** A message as it was sent: what the stream already holds is dropped, the rest (injected instructions) kept. */
  #wire(entry: Obj, bytes: number): void {
    const message = object(entry.message) ? entry.message : {};
    const content = message.content;
    const parts: Json[] = [];
    const wired: Json[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const part of wired) {
      if (!object(part)) continue;
      if (part.type === 'tool_use' && this.#tools.has(`call:${text(part.id)}`)) continue;
      if (part.type === 'tool_result' && this.#tools.has(`result:${text(part.tool_use_id)}`)) continue;
      if (part.type === 'text' && this.#texts.has(sha256(text(part.text)))) continue;
      if ((part.type === 'thinking' || part.type === 'redacted_thinking') && this.#texts.has(sha256(text(part.thinking)))) continue;
      if (part.type === 'tool_result') parts.push(record({ k: 'result', call: part.tool_use_id, out: capContent(part.content, part.is_error === true, this.sink), error: part.is_error === true ? true : undefined }));
      else if (part.type === 'thinking' || part.type === 'redacted_thinking') parts.push({ type: 'reasoning', text: text(part.thinking) });
      else parts.push(stripBlobs(part, this.sink));
    }
    if (parts.length === 0) this.sink.count('dropped: wire copy', bytes);
    else this.emit(record({ k: 'wire', role: message.role, parts }));
  }
}
