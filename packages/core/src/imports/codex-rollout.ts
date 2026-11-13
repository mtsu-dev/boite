/*
 * The records of a Codex rollout: one JSON object per line, each
 * `{ timestamp, type, payload }`. The first line is `session_meta`, whose
 * payload names the session (`id`), the working directory (`cwd`) and who
 * started it (`source`: a string for a session a person ran, an object for a
 * subagent's). The conversation is read from the `event_msg` records, which
 * hold what the CLI itself shows:
 *
 * - since 0.165, `item_completed` with an `item` of type `UserMessage`,
 *   `AgentMessage`, `Reasoning`, `CommandExecution`, `FileChange` or
 *   `McpToolCall`;
 * - before, `user_message`, `agent_message` and `agent_reasoning`, the tools
 *   being the `response_item` records `function_call`, `custom_tool_call`,
 *   `local_shell_call` and their `_output`.
 *
 * A file speaks one of the two: the first conversation record met decides,
 * and the other dialect's records are skipped, so a CLI that writes both
 * never doubles a prompt. `response_item` messages are never read as
 * prompts: they also carry the context the CLI injects under the user role.
 * `turn_context` names the model of each turn.
 */

import { IMAGE_MIME_TYPES } from '@boite/contracts';
import type { ImageMimeType, MessagePart } from '@boite/contracts';
import { stringify } from '../drivers/tool-text.ts';
import { COMMAND_TOOL_NAME, FILE_CHANGE_TOOL_NAME } from '../drivers/codex/protocol.ts';
import { TOOL_OUTPUT_MAX } from './claude.ts';
import type { TranscriptTurn } from './claude.ts';

type Json = { [key: string]: unknown };
type ToolPart = Extract<MessagePart, { type: 'tool' }>;

function object(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** One line as a record, or null when it is blank or not a JSON object. */
export function parseRecord(line: string): Json | null {
  if (line.trim().length === 0) return null;
  try {
    return object(JSON.parse(line));
  } catch {
    return null;
  }
}

/** What the first line of a rollout says of its session. */
export interface RolloutMeta {
  /** The Codex thread id: what `thread/resume` takes. */
  id: string;
  cwd: string;
  /** Started by another agent, not by a person: never listed. */
  subagent: boolean;
}

/** Why a rollout's first line cannot be used: the field at fault and what it should hold. */
export interface RolloutReject {
  field: string;
  expected: string;
}

const ROLLOUT_ID = /^[A-Za-z0-9_-]+$/;

/** The session a first line describes, or the field that keeps it from being read. */
export function metaOf(line: string): RolloutMeta | RolloutReject {
  const record = parseRecord(line);
  if (record === null) return { field: 'line 1', expected: 'a JSON object' };
  if (record['type'] !== 'session_meta') return { field: 'type', expected: '"session_meta" on line 1' };
  const payload = object(record['payload']);
  if (payload === null) return { field: 'payload', expected: 'an object' };
  const id = text(payload['id']);
  if (id === null || !ROLLOUT_ID.test(id)) return { field: 'payload.id', expected: 'letters, digits, dashes and underscores' };
  const cwd = text(payload['cwd']);
  if (cwd === null || cwd.length === 0) return { field: 'payload.cwd', expected: 'a working directory' };
  // `\\?\C:\x` is how Codex writes a long Windows path.
  return { id, cwd: cwd.replace(/^\\\\\?\\/, ''), subagent: typeof payload['source'] !== 'string' && payload['source'] !== undefined && payload['source'] !== null };
}

export function isReject<T extends object>(value: T | RolloutReject): value is RolloutReject {
  return 'field' in value;
}

function timeOf(record: Json): number {
  const parsed = typeof record['timestamp'] === 'string' ? Date.parse(record['timestamp']) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function cut(value: string | null): string | null {
  return value !== null && value.length > TOOL_OUTPUT_MAX ? `${value.slice(0, TOOL_OUTPUT_MAX)}\n[cut]` : value;
}

/** `completed`, `failed`, `declined`; anything else never finished in the file. */
function statusOf(status: unknown): ToolPart['status'] {
  if (status === 'completed') return 'done';
  if (status === 'declined') return 'denied';
  return 'error';
}

/** A `data:` URL as an image part, or null for a link or a type Boite does not show. */
function imageOf(url: unknown): TranscriptTurn['images'][number] | null {
  if (typeof url !== 'string') return null;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  if (match === null || !(IMAGE_MIME_TYPES as readonly string[]).includes(match[1]!)) return null;
  return { mimeType: match[1] as ImageMimeType, data: match[2]! };
}

/** `["bash", "-lc", "ls"]` reads `ls`; any other vector is joined. */
function commandText(command: unknown): string {
  if (typeof command === 'string') return command;
  const words = list(command).filter((word): word is string => typeof word === 'string');
  if (words.length === 3 && (words[1] === '-lc' || words[1] === '-c')) return words[2]!;
  return words.join(' ');
}

/** The rollout's map of path to change, as the list the live `fileChange` item carries. */
function changesOf(changes: unknown): unknown {
  const byPath = object(changes);
  if (byPath === null) return list(changes);
  return Object.entries(byPath).map(([path, raw]) => {
    const change = object(raw) ?? {};
    return {
      path,
      kind: { type: text(change['type']) ?? 'update', move_path: text(change['move_path']) },
      diff: text(change['unified_diff']) ?? text(change['content']) ?? '',
    };
  });
}

/** The text of a tool output: a string, or blocks whose `text` is joined. */
function outputText(output: unknown): string | null {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.map((block) => text(object(block)?.['text']) ?? '').filter((piece) => piece.length > 0).join('\n');
  }
  const wrapped = object(output);
  if (wrapped !== null && typeof wrapped['content'] === 'string') return wrapped['content'];
  return stringify(output);
}

/** `arguments` is JSON in a string; one that does not parse is kept as written. */
function argumentsOf(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** What a rollout read whole gives. */
export interface Rollout {
  turns: TranscriptTurn[];
  /** The model the last `turn_context` names. */
  model: string | null;
}

/** Consumes a rollout's records one at a time; `finish()` closes the tools no output reached. */
export class RolloutReader {
  private readonly turns: TranscriptTurn[] = [];
  private model: string | null = null;
  /** Which of the two dialects the file speaks, once a conversation record said so. */
  private dialect: 'items' | 'events' | null = null;
  /** Calls of the older dialect waiting for their output, by `call_id`. */
  private readonly open = new Map<string, ToolPart>();

  /** True once a prompt has been seen: what a listing stops at. */
  get hasPrompt(): boolean {
    return this.turns.length > 0;
  }

  line(line: string): void {
    const record = parseRecord(line);
    if (record === null) return;
    const payload = object(record['payload']);
    if (payload === null) return;
    if (record['type'] === 'turn_context') {
      if (typeof payload['model'] === 'string' && payload['model'].length > 0) this.model = payload['model'];
    } else if (record['type'] === 'event_msg') {
      this.event(payload, timeOf(record));
    } else if (record['type'] === 'response_item' && this.dialect === 'events') {
      this.responseItem(payload, timeOf(record));
    }
  }

  private speaks(dialect: 'items' | 'events'): boolean {
    if (this.dialect === null) this.dialect = dialect;
    return this.dialect === dialect;
  }

  private event(payload: Json, at: number): void {
    switch (payload['type']) {
      case 'item_completed': {
        const item = object(payload['item']);
        if (item !== null && this.speaks('items')) this.item(item, at);
        return;
      }
      case 'user_message': {
        if (!this.speaks('events')) return;
        const images = list(payload['images']).map(imageOf).filter((image) => image !== null);
        this.prompt(text(payload['message']) ?? '', images, at);
        return;
      }
      case 'agent_message':
        if (this.speaks('events')) this.say(text(payload['message']) ?? '', at);
        return;
      case 'agent_reasoning':
        if (this.speaks('events')) this.think(text(payload['text']) ?? '', at);
        return;
      default:
    }
  }

  private item(item: Json, at: number): void {
    const blocks = list(item['content']).map(object).filter((block) => block !== null);
    switch (item['type']) {
      case 'UserMessage': {
        const prompt = blocks.map((block) => (block['type'] === 'text' ? text(block['text']) ?? '' : '')).filter((piece) => piece.length > 0).join('\n');
        const images = blocks
          .map((block) => (block['type'] === 'image' ? imageOf(block['image_url'] ?? block['url']) : null))
          .filter((image) => image !== null);
        this.prompt(prompt, images, at);
        return;
      }
      case 'AgentMessage':
        this.say(blocks.map((block) => text(block['text']) ?? '').join(''), at);
        return;
      case 'Reasoning': {
        const summary = list(item['summary_text']).filter((piece): piece is string => typeof piece === 'string');
        const raw = list(item['raw_content']).filter((piece): piece is string => typeof piece === 'string');
        this.think((summary.length > 0 ? summary : raw).join('\n\n'), at);
        return;
      }
      case 'CommandExecution':
        this.tool({
          type: 'tool',
          toolId: text(item['id']) ?? `command-${at}`,
          name: COMMAND_TOOL_NAME,
          input: { command: commandText(item['command']), cwd: text(item['cwd']) },
          output: cut(text(item['aggregated_output'])),
          status: statusOf(item['status']),
          ...(typeof item['exit_code'] === 'number' ? { exitCode: item['exit_code'] } : {}),
        }, at);
        return;
      case 'FileChange':
        this.tool({
          type: 'tool',
          toolId: text(item['id']) ?? `patch-${at}`,
          name: FILE_CHANGE_TOOL_NAME,
          input: { changes: changesOf(item['changes']) },
          output: cut(text(item['stderr']) || null),
          status: statusOf(item['status']),
        }, at);
        return;
      case 'McpToolCall': {
        const failure = text(object(item['error'])?.['message']);
        this.tool({
          type: 'tool',
          toolId: text(item['id']) ?? `mcp-${at}`,
          name: text(item['tool']) ?? 'mcp',
          input: item['arguments'] ?? null,
          output: cut(failure ?? stringify(item['result'])),
          status: statusOf(item['status']),
        }, at);
        return;
      }
      default:
    }
  }

  /** The older dialect's tool calls and their outputs. */
  private responseItem(payload: Json, at: number): void {
    const callId = text(payload['call_id']);
    if (callId === null) return;
    switch (payload['type']) {
      case 'function_call':
      case 'custom_tool_call': {
        const part: ToolPart = {
          type: 'tool',
          toolId: callId,
          name: text(payload['name']) ?? 'tool',
          input: payload['type'] === 'function_call' ? argumentsOf(payload['arguments']) : payload['input'] ?? null,
          output: null,
          status: 'running',
        };
        if (this.tool(part, at)) this.open.set(callId, part);
        return;
      }
      case 'local_shell_call': {
        const part: ToolPart = {
          type: 'tool',
          toolId: callId,
          name: COMMAND_TOOL_NAME,
          input: { command: commandText(object(payload['action'])?.['command']), cwd: null },
          output: null,
          status: 'running',
        };
        if (this.tool(part, at)) this.open.set(callId, part);
        return;
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
      case 'local_shell_call_output': {
        const part = this.open.get(callId);
        if (part === undefined) return;
        part.output = cut(outputText(payload['output']));
        part.status = 'done';
        this.open.delete(callId);
        const current = this.turns[this.turns.length - 1];
        if (current !== undefined) current.lastAt = Math.max(current.lastAt, at);
        return;
      }
      default:
    }
  }

  private prompt(prompt: string, images: TranscriptTurn['images'], at: number): void {
    if (prompt.length === 0 && images.length === 0) return;
    this.turns.push({ prompt, images, promptAt: at, parts: [], answerAt: null, lastAt: at });
  }

  /** Two messages in a row are one text part, a blank line between them. */
  private say(message: string, at: number): void {
    const current = this.turns[this.turns.length - 1];
    if (current === undefined || message.length === 0) return;
    const last = current.parts[current.parts.length - 1];
    if (last !== undefined && last.type === 'text') last.text += `\n\n${message}`;
    else current.parts.push({ type: 'text', text: message });
    this.answered(current, at);
  }

  private think(thought: string, at: number): void {
    const current = this.turns[this.turns.length - 1];
    if (current === undefined || thought.trim().length === 0) return;
    current.parts.push({ type: 'thinking', text: thought });
    this.answered(current, at);
  }

  /** False when no prompt came before the call: it belongs to no turn. */
  private tool(part: ToolPart, at: number): boolean {
    const current = this.turns[this.turns.length - 1];
    if (current === undefined) return false;
    current.parts.push(part);
    this.answered(current, at);
    return true;
  }

  private answered(turn: TranscriptTurn, at: number): void {
    if (turn.answerAt === null) turn.answerAt = at;
    turn.lastAt = Math.max(turn.lastAt, at);
  }

  finish(): Rollout {
    // A call the rollout never answered: the session stopped on it.
    for (const part of this.open.values()) {
      part.status = 'error';
      part.output = 'no result in the transcript';
    }
    this.open.clear();
    return { turns: this.turns, model: this.model };
  }
}
