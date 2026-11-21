/*
 * Claude Code's transcripts: one JSON record per line under
 * `<config dir>/projects/<folder>/<session id>.jsonl`, the folder being the
 * working directory with every character outside [A-Za-z0-9] turned into `-`.
 * A prompt is a `user` record whose content is a string or carries a text
 * block; a `user` record made of `tool_result` blocks answers the assistant's
 * `tool_use`; each `assistant` record carries one content block (text,
 * thinking or tool_use) of a message several records share. Sidechain records
 * are subagents' and are left out. `ai-title` and `summary` records name the
 * session in the agent's own words.
 *
 * The CLI also files its own records as `user` ones: meta records (a skill's
 * body, a caveat), the compaction summary, background task notifications,
 * a command's output and the interrupt marker. None of them is something the
 * user typed, so none becomes a prompt. A slash command and a shell command
 * are kept as the user typed them, `/review args` and `!ls`. The CLI's
 * `<synthetic>` assistant records are an error it shows, kept, or a filler
 * reply, left out; neither is the agent answering.
 */

import { IMAGE_MIME_TYPES } from '@boite/contracts';
import type { ImageMimeType, MessagePart } from '@boite/contracts';

/** What one tool's output is cut to before it is journalled. */
export const TOOL_OUTPUT_MAX = 20_000;

/** One exchange of the transcript: the prompt and what the agent did with it. */
export interface TranscriptTurn {
  prompt: string;
  images: { mimeType: ImageMimeType; data: string }[];
  promptAt: number;
  /** The assistant's parts in order, text runs merged, every tool with its result. */
  parts: MessagePart[];
  answerAt: number | null;
  lastAt: number;
}

export interface Transcript {
  /** Empty for a session of bare commands the agent never answered. */
  turns: TranscriptTurn[];
  /** The first prompt that is not a command, else the first command: what names the session. */
  titlePrompt: string | null;
  /** The agent's own title, from the last `ai-title` or `summary` record. */
  agentTitle: string | null;
  /** The working directory the first prompt was sent from. */
  cwd: string | null;
  /** The model the last assistant record names. */
  model: string | null;
}

/** The folder name Claude Code files a working directory's sessions under. */
export function claudeProjectFolder(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

interface Record {
  type?: unknown;
  isSidechain?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  aiTitle?: unknown;
  summary?: unknown;
  isMeta?: unknown;
  isCompactSummary?: unknown;
  isApiErrorMessage?: unknown;
  message?: { id?: unknown; content?: unknown; model?: unknown };
}

type Block = { type?: unknown; [key: string]: unknown };

function timeOf(record: Record): number {
  const parsed = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function blocksOf(content: unknown): Block[] {
  return Array.isArray(content) ? content.filter((block): block is Block => typeof block === 'object' && block !== null) : [];
}

/** The text of a tool result, its blocks joined, cut at the cap. */
function resultText(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : blocksOf(content)
          .map((block) => (block['type'] === 'text' && typeof block['text'] === 'string' ? block['text'] : ''))
          .join('\n');
  return text.length > TOOL_OUTPUT_MAX ? `${text.slice(0, TOOL_OUTPUT_MAX)}\n[cut]` : text;
}

/** Records the CLI writes as the user's: what they open with. */
const CLI_RECORDS = [
  '<task-notification>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<local-command-caveat>',
  '<bash-stdout>',
  '<bash-stderr>',
];

/** The CLI's marker for a turn the user stopped. */
const INTERRUPTS = new Set(['[Request interrupted by user]', '[Request interrupted by user for tool use]']);

/** The model the CLI names on an assistant record it wrote itself. */
const SYNTHETIC_MODEL = '<synthetic>';

/**
 * A user record's text as the user typed it: a slash command as `/name args`,
 * a shell command as `!command`. Null for a record the CLI wrote.
 */
function typedOf(text: string): { text: string; command: boolean } | null {
  const trimmed = text.trim();
  if (INTERRUPTS.has(trimmed) || CLI_RECORDS.some((tag) => trimmed.startsWith(tag))) return null;
  const shell = /^<bash-input>([\s\S]*)<\/bash-input>$/.exec(trimmed);
  if (shell !== null) return { text: `!${shell[1]}`, command: true };
  if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<command-message>')) {
    const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(trimmed)?.[1]?.trim();
    if (name !== undefined && name.length > 0) {
      // Up to the last closing tag: the CLI writes the arguments as typed, tags included.
      const args = /<command-args>([\s\S]*)<\/command-args>/.exec(trimmed)?.[1]?.trim() ?? '';
      const slash = name.startsWith('/') ? name : `/${name}`;
      return { text: args.length > 0 ? `${slash} ${args}` : slash, command: true };
    }
  }
  return { text, command: false };
}

/** The prompt of a `user` record, or null when the record answers a tool or the CLI wrote it. */
function promptOf(record: Record): { text: string; images: TranscriptTurn['images']; command: boolean } | null {
  if (record.isMeta === true || record.isCompactSummary === true) return null;
  const content = record.message?.content;
  if (typeof content === 'string') {
    const typed = typedOf(content);
    return typed === null ? null : { ...typed, images: [] };
  }
  const blocks = blocksOf(content);
  if (blocks.some((block) => block['type'] === 'tool_result')) return null;
  const text = blocks
    .map((block) => (block['type'] === 'text' && typeof block['text'] === 'string' ? block['text'] : ''))
    .filter((piece) => piece.length > 0)
    .join('\n');
  const images: TranscriptTurn['images'] = [];
  for (const block of blocks) {
    const source = block['source'];
    if (block['type'] !== 'image' || typeof source !== 'object' || source === null) continue;
    const { media_type: mimeType, data } = source as { media_type?: unknown; data?: unknown };
    if (typeof data !== 'string' || !(IMAGE_MIME_TYPES as readonly unknown[]).includes(mimeType)) continue;
    images.push({ mimeType: mimeType as ImageMimeType, data });
  }
  if (text.length === 0 && images.length === 0) return null;
  if (text.length === 0) return { text, images, command: false };
  const typed = typedOf(text);
  return typed === null ? null : { ...typed, images };
}

function parse(line: string): Record | null {
  if (line.trim().length === 0) return null;
  try {
    const record = JSON.parse(line) as unknown;
    return typeof record === 'object' && record !== null ? (record as Record) : null;
  } catch {
    return null;
  }
}

/** A substring test that lets most lines by without a parse. */
function mayBeTitle(line: string): boolean {
  return line.includes('"ai-title"') || line.includes('"summary"');
}

/** The agent's title an `ai-title` or `summary` record carries, else null. */
function titleOf(record: Record): string | null {
  if (record.type === 'ai-title' && typeof record.aiTitle === 'string' && record.aiTitle.length > 0) return record.aiTitle;
  if (record.type === 'summary' && typeof record.summary === 'string' && record.summary.length > 0) return record.summary;
  return null;
}

/** An assistant block as a part, or null for an empty or unknown one. */
function partOf(block: Block): MessagePart | null {
  if (block['type'] === 'text' && typeof block['text'] === 'string') {
    return block['text'].length === 0 ? null : { type: 'text', text: block['text'] };
  }
  if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
    return block['thinking'].trim().length === 0 ? null : { type: 'thinking', text: block['thinking'] };
  }
  if (block['type'] === 'tool_use' && typeof block['id'] === 'string' && typeof block['name'] === 'string') {
    return { type: 'tool', toolId: block['id'], name: block['name'], input: block['input'] ?? null, output: null, status: 'running' };
  }
  return null;
}

/** Consumes records one at a time; `finish()` closes the tools no result reached. */
class TranscriptReader {
  private readonly turns: TranscriptTurn[] = [];
  private agentTitle: string | null = null;
  private cwd: string | null = null;
  private model: string | null = null;
  /** The first turn that is not a command. */
  private firstPrompt: TranscriptTurn | null = null;
  /** True once the agent itself answered a turn, a synthetic error aside. */
  private answered = false;
  /** The message the last assistant record belongs to: text merges within one. */
  private message: unknown = undefined;
  private readonly tools = new Map<string, Extract<MessagePart, { type: 'tool' }>>();

  /** A listing keeps no reply, only whether there was one: commands before the first prompt can carry megabytes. */
  constructor(private readonly listing = false) {}

  /**
   * True once a prompt that is not a command has been seen: what a listing
   * stops at, since it names the session and makes it worth importing.
   */
  get hasPrompt(): boolean {
    return this.firstPrompt !== null;
  }

  /**
   * A listing needs the first prompt and the title records: once the prompt
   * is in hand, every other line is skipped on a substring test, no parse.
   * Commands before it are read through, with the replies they got.
   */
  lineForListing(line: string): void {
    if (this.hasPrompt && !mayBeTitle(line)) return;
    this.line(line);
  }

  line(line: string): void {
    const record = parse(line);
    if (record === null) return;
    const title = titleOf(record);
    if (title !== null) {
      this.agentTitle = title;
      return;
    }
    if (record.isSidechain === true) return;
    if (record.type === 'user') this.user(record);
    else if (record.type === 'assistant') this.assistant(record);
  }

  private user(record: Record): void {
    const at = timeOf(record);
    const prompt = promptOf(record);
    if (prompt !== null) {
      if (this.turns.length === 0) this.cwd = typeof record.cwd === 'string' ? record.cwd : null;
      const turn: TranscriptTurn = { prompt: prompt.text, images: prompt.images, promptAt: at, parts: [], answerAt: null, lastAt: at };
      this.turns.push(turn);
      if (!prompt.command && this.firstPrompt === null) this.firstPrompt = turn;
      return;
    }
    const current = this.turns[this.turns.length - 1];
    for (const block of blocksOf(record.message?.content)) {
      if (block['type'] !== 'tool_result' || typeof block['tool_use_id'] !== 'string') continue;
      const tool = this.tools.get(block['tool_use_id']);
      if (tool === undefined) continue;
      tool.output = resultText(block['content']);
      tool.status = block['is_error'] === true ? 'error' : 'done';
      this.tools.delete(block['tool_use_id']);
      if (current !== undefined) current.lastAt = Math.max(current.lastAt, at);
    }
  }

  private assistant(record: Record): void {
    const current = this.turns[this.turns.length - 1];
    if (current === undefined) return;
    const at = timeOf(record);
    const synthetic = record.message?.model === SYNTHETIC_MODEL;
    // The CLI's filler after an interrupt, "No response requested.": nothing happened.
    if (synthetic && record.isApiErrorMessage !== true) return;
    if (!synthetic && typeof record.message?.model === 'string') this.model = record.message.model;
    const id = record.message?.id;
    // Text merges into the last part only within one message, this record's earlier blocks included.
    let sameMessage = id !== undefined && id === this.message;
    this.message = id;
    for (const block of blocksOf(record.message?.content)) {
      const part = partOf(block);
      if (part === null) continue;
      if (!synthetic) this.answered = true;
      if (this.listing) continue;
      const last = current.parts[current.parts.length - 1];
      if (part.type === 'text' && sameMessage && last !== undefined && last.type === 'text') last.text += part.text;
      else current.parts.push(part);
      if (part.type === 'tool') this.tools.set(part.toolId, part);
      sameMessage = true;
      if (current.answerAt === null) current.answerAt = at;
      current.lastAt = Math.max(current.lastAt, at);
    }
  }

  finish(): Transcript {
    // A call the transcript never answered: the session stopped on it.
    for (const tool of this.tools.values()) {
      tool.status = 'error';
      tool.output = 'no result in the transcript';
    }
    this.tools.clear();
    // Bare commands the agent never answered: nothing was asked of it.
    const turns = this.firstPrompt !== null || this.answered ? this.turns : [];
    const titlePrompt = this.firstPrompt?.prompt ?? turns[0]?.prompt ?? null;
    return { turns, titlePrompt, agentTitle: this.agentTitle, cwd: this.cwd, model: this.model };
  }
}

/**
 * Reads the file line by line without holding it whole: a long session is
 * tens of megabytes. `listing` parses the first prompt and the title records
 * only, which is what a list of sessions needs.
 */
export async function readTranscript(file: string, listing = false): Promise<Transcript> {
  const reader = new TranscriptReader(listing);
  await readLines(file, listing ? (line) => reader.lineForListing(line) : (line) => reader.line(line));
  return reader.finish();
}

/**
 * Feeds `take` the file's lines in order until it returns false. True when
 * every line was read.
 */
async function readLines(file: string, take: (line: string) => boolean | void): Promise<boolean> {
  const decoder = new TextDecoder();
  let rest = '';
  const chunks = Bun.file(file).stream().getReader();
  try {
    for (;;) {
      const { done, value } = await chunks.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      let cut = rest.indexOf('\n');
      while (cut >= 0) {
        if (take(rest.slice(0, cut)) === false) return false;
        rest = rest.slice(cut + 1);
        cut = rest.indexOf('\n');
      }
    }
    rest += decoder.decode();
    take(rest);
    return true;
  } finally {
    await chunks.cancel().catch(() => undefined);
  }
}

/** How much of a transcript's end a listing reads to find its last title record. */
export const LISTING_TAIL_BYTES = 256 * 1024;

/** What a list of sessions shows of one transcript. */
export interface TranscriptListing {
  /** The first prompt that is not a command, else the first command. */
  prompt: string;
  /** When the first turn, command or not, was sent. */
  promptAt: number;
  /** The working directory the first prompt was sent from. */
  cwd: string | null;
  /** The last `ai-title` or `summary` record, as a full read would give it. */
  agentTitle: string | null;
}

/**
 * The first prompt, read from the head up to that prompt, and the last title,
 * read from the last 256 KB: a long session is tens of megabytes, and the CLI
 * writes its `ai-title` record again all along the file. A tail with no title
 * falls back to reading the whole file, which old transcripts with a single
 * `summary` near the head need. Null when the transcript has no prompt.
 */
export async function listTranscript(file: string): Promise<TranscriptListing | null> {
  const reader = new TranscriptReader(true);
  const whole = await readLines(file, (line) => {
    reader.lineForListing(line);
    return !reader.hasPrompt;
  });
  const head = reader.finish();
  const first = head.turns[0];
  if (first === undefined || head.titlePrompt === null) return null;
  const listing = { prompt: head.titlePrompt, promptAt: first.promptAt, cwd: head.cwd };
  // The head reached the end: it saw every title record already.
  if (whole) return { ...listing, agentTitle: head.agentTitle };
  const blob = Bun.file(file);
  const size = blob.size;
  const start = Math.max(0, size - LISTING_TAIL_BYTES);
  // One byte before the window tells whether it starts on a line; the first
  // piece is dropped either way, a cut line or a cut character with it.
  const lines = (await blob.slice(start === 0 ? 0 : start - 1, size).text()).split('\n');
  if (start > 0) lines.shift();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (!mayBeTitle(line)) continue;
    const record = parse(line);
    const title = record === null ? null : titleOf(record);
    if (title !== null) return { ...listing, agentTitle: title };
  }
  if (start === 0) return { ...listing, agentTitle: null };
  return { ...listing, agentTitle: (await readTranscript(file, true)).agentTitle };
}
