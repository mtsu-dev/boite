/*
 * A Codex rollout (`rollout-<time>-<session>.jsonl`) into the records of
 * `records.ts`. What goes: the encrypted reasoning nobody can read (its
 * summary stays), the running token totals, the start line of an item its end
 * line repeats, and the event copies of messages the stream already holds.
 * An item of the `exec` tool (a command, a file change, an MCP call) is no
 * copy: it is the only record of what ran inside, and stays with its exit code.
 */

import { capContent, capOutput, object, record, scalars, sha256, stripBlobs, type Json, type Obj, type Sink, type TranscriptRecord } from './records.ts';

type Emit = (record: TranscriptRecord) => void;

const OUTPUTS = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output', 'mcp_tool_call_output', 'tool_search_output']);
const CALLS = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'mcp_tool_call', 'tool_search_call', 'web_search_call', 'image_generation_call']);
/** Fields of an item that hold a tool's output. */
const ITEM_OUTPUTS = new Set(['aggregated_output', 'stdout', 'stderr', 'formatted_output', 'result', 'output', 'error']);
/** Items that say again what a `response_item` said. */
const MIRRORS = new Set(['UserMessage', 'AgentMessage', 'Reasoning']);
const MIRROR_FIELDS = new Set(['content', 'summary_text', 'raw_content']);
const FAILED_OUTPUT = /exit code: [1-9]|"exit_code":\s*[1-9]|^error/i;

const text = (value: Json | undefined): string => typeof value === 'string' ? value : '';
const texts = (value: Json | undefined): string[] => Array.isArray(value)
  ? value.flatMap(item => object(item) && typeof item.text === 'string' ? [item.text] : [])
  : [];

/** What names a part of a message: its text, or the part itself. */
const mark = (part: Json): string => sha256(typeof part === 'string' ? part : JSON.stringify(part));

/**
 * The output older rollouts wrap as JSON text, `{"output": "...", "metadata": {"exit_code": 9}}`:
 * the exit code is read from the structure, wherever a long output would have pushed it.
 */
function envelope(output: Json | undefined): { output: Json; exit: number | undefined; info: Obj | undefined } | null {
  if (typeof output !== 'string' || !output.startsWith('{')) return null;
  let parsed: Json;
  try { parsed = JSON.parse(output) as Json; } catch { return null; }
  if (!object(parsed) || !('output' in parsed) || !object(parsed.metadata)) return null;
  const { output: inner, metadata, ...rest } = parsed;
  if (Object.keys(rest).length > 0) return null;
  const info = scalars(metadata);
  return { output: inner ?? '', exit: typeof metadata.exit_code === 'number' ? metadata.exit_code : undefined, info: info !== null && Object.keys(info).length > 0 ? info : undefined };
}

export class CodexNormalizer {
  /** Texts and other parts already in the stream: an event that repeats them is dropped. */
  readonly #seen = new Set<string>();

  constructor(private readonly sink: Sink, private readonly emit: Emit) {}

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
    const payload = entry.payload;
    if (!object(payload)) {
      this.sink.count(`in:${type}`, bytes);
      this.emit(record({ t: entry.timestamp, k: 'other', type, data: payload }));
      return;
    }
    const kind = text(payload.type);
    this.sink.count(type === 'event_msg' ? 'in:event_msg' : kind ? `in:${type}/${kind}` : `in:${type}`, bytes);
    const passthrough = payload.internal_chat_message_metadata_passthrough;
    const turn = (object(passthrough) ? text(passthrough.turn_id) : '') || text(payload.turn_id);
    const base: { [key: string]: Json | undefined } = { t: entry.timestamp, turn: turn ? turn.slice(-12) : undefined };
    if (type === 'response_item') this.#response(kind, payload, base);
    else if (type === 'event_msg') this.#event(kind, payload, base, bytes);
    else if (type === 'token_usage_record') this.emit(record({ ...base, k: 'usage', ...(object(payload.usage) ? payload.usage : {}), response: payload.response_id }));
    else if (type === 'session_meta' || type === 'world_state' || type === 'turn_context') this.emit(record({ ...base, k: 'context', what: type, data: stripBlobs(payload, this.sink) }));
    else if (type === 'compacted') this.emit(record({ ...base, k: 'summary', data: stripBlobs(payload, this.sink) }));
    else this.emit(record({ ...base, k: 'other', type, data: stripBlobs(payload, this.sink) }));
  }

  end(): void {}

  #response(kind: string, payload: Obj, base: { [key: string]: Json | undefined }): void {
    const status = payload.status !== undefined && payload.status !== null && payload.status !== 'completed' ? payload.status : undefined;
    if (OUTPUTS.has(kind)) {
      const wrapped = envelope(payload.output);
      const output = wrapped?.output ?? payload.output;
      const exit = wrapped?.exit;
      const failed = exit !== undefined ? exit !== 0 : typeof output === 'string' && FAILED_OUTPUT.test(output.slice(0, 400));
      this.emit(record({ ...base, k: 'result', call: payload.call_id, out: capContent(output, failed, this.sink), exit, error: failed ? true : undefined, info: wrapped?.info, status }));
    } else if (CALLS.has(kind)) {
      const input = payload.arguments ?? payload.input ?? payload.action;
      this.emit(record({ ...base, k: 'call', call: payload.call_id ?? payload.id, tool: payload.name ?? kind, input: stripBlobs(input, this.sink, false), status }));
    } else if (kind === 'reasoning') {
      const sealed = text(payload.encrypted_content).length;
      this.sink.count('dropped: encrypted reasoning', sealed);
      this.emit(record({ ...base, k: 'reasoning', text: [...texts(payload.summary), ...texts(payload.content)].join('\n\n'), sealed: sealed > 0 ? sealed : undefined }));
    } else if (kind === 'message') {
      const content = stripBlobs(payload.content, this.sink);
      if (payload.role === 'developer' || payload.role === 'system') {
        this.emit(record({ ...base, k: 'context', role: payload.role, parts: content }));
        return;
      }
      const said = texts(content);
      const rest = Array.isArray(content) ? content.filter(item => !(object(item) && typeof item.text === 'string')) : [];
      for (const item of [...said, ...rest]) this.#seen.add(mark(item));
      this.emit(record({ ...base, k: payload.role === 'assistant' ? 'assistant' : 'user', text: said.join('\n'), parts: rest.length > 0 ? rest : undefined }));
    } else if (kind === 'additional_tools') {
      this.emit(record({ ...base, k: 'context', what: 'tools', tools: payload.tools }));
    } else {
      const { encrypted_content: _sealed, internal_chat_message_metadata_passthrough: _meta, ...rest } = payload;
      this.emit(record({ ...base, k: 'other', type: kind, data: stripBlobs(rest, this.sink) }));
    }
  }

  #event(kind: string, payload: Obj, base: { [key: string]: Json | undefined }, bytes: number): void {
    const item = payload.item;
    if ((kind === 'item_completed' || kind === 'item_started' || kind === 'item_updated') && object(item)) {
      if (kind !== 'item_completed') { this.sink.count('dropped: item start', bytes); return; }
      const fields = this.#item(stripBlobs(item, this.sink) as Obj);
      if (fields === null) { this.sink.count('dropped: event copy', bytes); return; }
      this.emit(record({ ...base, ...fields, k: 'item', started: payload.started_at_ms, ended: payload.completed_at_ms }));
    } else if (kind === 'token_count') this.sink.count('dropped: running token totals', bytes);
    else {
      const { type: _type, turn_attribution: _attribution, ...rest } = payload;
      this.emit(record({ ...base, ...(stripBlobs(rest, this.sink) as Obj), k: 'event', type: kind }));
    }
  }

  /** An item's fields with its outputs capped; null when it only repeats messages already in the stream. */
  #item(item: Obj): Obj | null {
    const failed = (typeof item.exit_code === 'number' && item.exit_code !== 0) || item.status === 'failed' || item.status === 'declined' || Boolean(item.error);
    const mirror = MIRRORS.has(text(item.type));
    const out: Obj = {};
    let said = false;
    for (const [key, value] of Object.entries(item)) {
      if (ITEM_OUTPUTS.has(key) && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        out[key] = object(value) && '$blob' in value ? value : capOutput(typeof value === 'string' ? value : JSON.stringify(value), failed, this.sink);
        said = true;
      } else if (mirror && MIRROR_FIELDS.has(key)) {
        // Part by part: an image the message did not carry stays even when every text beside it is known.
        const parts = Array.isArray(value) ? value : value === null || value === '' ? [] : [value];
        const fresh = parts.filter(part => !this.#seen.has(mark(object(part) && typeof part.text === 'string' ? part.text : part)));
        for (const part of fresh) this.#seen.add(mark(object(part) && typeof part.text === 'string' ? part.text : part));
        if (fresh.length > 0) { out[key] = Array.isArray(value) ? fresh : value; said = true; }
      } else out[key] = value;
    }
    if (mirror && !said) return null;
    if (failed) out.failed = true;
    return out;
  }
}
