import type { Message, MessagePart, MoveNotice, ThreadLink, ThreadSummary } from '@boite/contracts';
import { QUOTE } from './markdown';
import { FenceScan, fenceLanguage, openFence } from './fences';

/** Older cores journalled the whole goal instruction as a user message. */
export function visibleUserText(text: string): string {
  const legacy = /^Work toward this goal: ([\s\S]*?)\r?\nContinue until the objective is achieved\./.exec(text);
  return legacy ? `/goal ${legacy[1]}` : text;
}

/** Hide protocol-only lines, including a marker that is still streaming. */
export function visibleAnswer(text: string): string {
  // Only the last line that is not blank can hold the marker, so the regex reads
  // from the break before it rather than trying every offset of the answer.
  const from = Math.max(0, text.trimEnd().lastIndexOf('\n'));
  const tail = /(?:^|\n)([\t ]*\[BOITE[^\r\n]*?)[\t ]*(?:\r?\n[\t ]*)*$/.exec(text.slice(from));
  if (!tail) return text;
  const marker = tail[1]!.trim();
  if (!['[BOITE_GOAL_COMPLETE]', '[BOITE_GOAL_BLOCKED]'].some(value => value.startsWith(marker))) return text;
  const index = from + tail.index;
  const start = index + (text[index] === '\n' ? 1 : 0);
  // A terminal marker inside an unfinished fenced example is still answer content.
  const fences = new FenceScan();
  for (const line of text.slice(0, start).split('\n')) fences.line(line);
  return fences.inside ? text : text.slice(0, start);
}

export function messagePreview(message: Message): string {
  return message.parts.filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text').map(part => promptText(part)).join(' ').trim();
}

export function promptText(part: Extract<MessagePart, { type: 'text' }>): string {
  return part.displayText ?? visibleUserText(part.text);
}

export interface PromptSegment {
  text: string;
  kind: 'plain' | 'command' | 'ultrathink' | 'ultracode';
}

/**
 * The words Claude Code acts on anywhere in a prompt: `ultrathink` asks for the
 * deepest thinking on that turn, `ultracode` opts the turn into the Workflow
 * tool. Other harnesses read them as plain words.
 */
const PROMPT_KEYWORDS = /\b(ultrathink|ultracode)\b/gi;

/**
 * Whether the keywords do anything: Claude Code has to run the turn, and on a
 * Claude model. A `claude-sdk` descriptor routed to another model, or a Claude
 * model behind another harness, reads them as plain words. No model is the
 * CLI's own default, a Claude one.
 */
export function claudeKeywords(protocol: string | undefined, model: string | null | undefined): boolean {
  if (protocol !== 'claude-sdk') return false;
  return model == null || /^(claude|opus|sonnet|haiku|fable|default)(?![a-z0-9])/i.test(model);
}

/** A prompt cut where it is drawn differently: the command it opens with, then each keyword. */
export function promptSegments(text: string, command: string | undefined, keywords: boolean): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const start = command && text.startsWith(command) ? command.length : 0;
  if (start > 0) segments.push({ text: command!, kind: 'command' });
  let at = start;
  if (keywords) {
    for (const match of text.slice(start).matchAll(PROMPT_KEYWORDS)) {
      const index = start + match.index;
      if (index > at) segments.push({ text: text.slice(at, index), kind: 'plain' });
      segments.push({ text: match[0], kind: match[0].toLowerCase() as 'ultrathink' | 'ultracode' });
      at = index + match[0].length;
    }
  }
  if (at < text.length) segments.push({ text: text.slice(at), kind: 'plain' });
  return segments;
}

/**
 * The segments that fall in `[start, end)` of the prompt they were cut from, so
 * a piece of the prompt keeps the keyword boundaries of the whole.
 */
export function sliceSegments(segments: PromptSegment[], start: number, end: number): PromptSegment[] {
  const slice: PromptSegment[] = [];
  let at = 0;
  for (const segment of segments) {
    const from = Math.max(at, start);
    const to = Math.min(at + segment.text.length, end);
    if (from < to) slice.push({ text: segment.text.slice(from - at, to - at), kind: segment.kind });
    at += segment.text.length;
  }
  return slice;
}

/** The Boite command a prompt opens with, drawn in the accent wherever the prompt is shown. */
export function promptCommand(text: string): string | undefined {
  return /^\/(goal2?|loop)(?=\s|$)/.exec(text)?.[0];
}

export function answerText(text: string, _live: boolean): string {
  return visibleAnswer(text);
}

/** Only complete paragraphs and fenced blocks enter the timeline while streaming. */
export function paragraphBlocks(text: string, live: boolean): string[] {
  return new ParagraphScan().blocks(text, live);
}

/**
 * A block as the renderer must see it: blank lines and trailing space go. The
 * first line's indent stays on a fence opener, whose code the renderer
 * outdents by that indent, and on a marker indented past one, which trimming
 * would turn into a fence the scanner never saw. Anywhere else, a heading
 * included, it goes as it always did.
 */
function blockText(text: string): string {
  const block = text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
  const cut = block.indexOf('\n');
  const first = cut < 0 ? block : block.slice(0, cut);
  return openFence(first.trimStart()) ? block : block.trimStart();
}

/**
 * paragraphBlocks for a text that grows: a new text that extends the last one
 * resumes at the last complete line, so a delta reads only its own lines. The
 * same array comes back until a paragraph completes. Only complete lines are
 * read, because an unfinished line can open a fence but never close a block.
 */
export class ParagraphScan {
  #read = 0;
  #searched = 0;
  #previous = '';
  #epoch: object | undefined;
  #start = 0;
  #fences = new FenceScan();
  #done: string[] = [];
  #tail = '';
  #result: string[] | null = null;
  #drawing = new DrawingScan();
  #drawAt = -1;

  /** The unfinished paragraph, for disclosures that show live text without parsing it. */
  pending(text: string): string { return blockText(text.slice(this.#start)); }

  /** Reuses the completed-line grammar, speculating only on the unfinished line. */
  drafting(text: string): { text: string; drawing: boolean } {
    const at = this.#drawAt >= 0 ? this.#drawAt : this.#drawing.line(text.slice(this.#read), false) ? this.#read : -1;
    return at < 0 ? { text: this.pending(text), drawing: false }
      : { text: blockText(text.slice(this.#start, at)).replace(/\r\n/g, '\n'), drawing: true };
  }

  /** An epoch is supplied only by a writer that records appends and rotates it on replacement. */
  blocks(text: string, live: boolean, epoch?: object): string[] {
    const append = epoch !== undefined && epoch === this.#epoch && text.length >= this.#previous.length;
    if ((epoch !== undefined && epoch !== this.#epoch) || (!append && !text.startsWith(this.#previous))) {
      this.#read = 0;
      this.#searched = 0;
      this.#start = 0;
      this.#fences.reset();
      this.#done = [];
      this.#result = null;
      this.#drawing = new DrawingScan();
      this.#drawAt = -1;
    }
    this.#previous = text;
    this.#epoch = epoch;
    let offset = this.#read;
    let grew = false;
    for (let end = text.indexOf('\n', this.#searched); end !== -1; end = text.indexOf('\n', offset)) {
      const line = text.slice(offset, end);
      if (this.#drawAt < 0 && this.#drawing.line(line)) this.#drawAt = offset;
      offset = end + 1;
      this.#fences.line(line);
      if (!this.#fences.inside && !line.trim()) {
        const block = blockText(text.slice(this.#start, offset));
        if (block) { this.#done.push(block); grew = true; }
        this.#start = offset;
        this.#drawing = new DrawingScan();
        this.#drawAt = -1;
      }
    }
    this.#read = offset;
    this.#searched = text.length;
    const tail = live ? '' : blockText(text.slice(this.#start));
    if (this.#result && !grew && tail === this.#tail) return this.#result;
    this.#tail = tail;
    this.#result = tail ? [...this.#done, tail] : [...this.#done];
    return this.#result;
  }
}

/** The fences `lib/rich-markdown.ts` draws, or a formula on lines of its own (`lib/markdown.ts`). */
const DRAWN = new Set(['mermaid', 'math', 'view']);
const DISPLAY_MATH = /^(?:\$\$|\\\[)/;

/**
 * The paragraph an answer is still writing (`ParagraphScan.pending`), cut
 * where a diagram, a formula or a view opens outside another fence: what is
 * written of it would show as source, then jump to a drawing, so a placeholder
 * stands there (`drawing`) until its paragraph is complete.
 */
export function pendingDrawing(tail: string): { text: string; drawing: boolean } {
  const lines = tail.split(/\r?\n/);
  const at = drawingLine(lines);
  return at < 0 ? { text: tail, drawing: false } : { text: lines.slice(0, at).join('\n').trimEnd(), drawing: true };
}

/**
 * The first of `lines` where a drawing opens, or -1. They are read as
 * `renderMarkdown` reads them: a fence under the shared grammar, and a quote as a
 * document of its own once its marks are off, so what is held back is what
 * it draws.
 */
function drawingLine(lines: string[]): number {
  const scan = new DrawingScan();
  for (let index = 0; index < lines.length; index++) {
    if (scan.line(lines[index]!)) return index;
  }
  return -1;
}

/** Each contiguous quote is its own document, including its own nested fences. */
class DrawingScan {
  #fences = new FenceScan();
  #quote: DrawingScan | null = null;

  line(line: string, complete = true): boolean {
    // pendingDrawing splits CRLF before descending through quote documents.
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (this.#fences.inside) {
      if (complete) this.#fences.line(line);
      return false;
    }
    const fence = openFence(line);
    if (fence) {
      if (complete) { this.#fences.line(line); this.#quote = null; }
      return DRAWN.has(fenceLanguage(fence).toLowerCase());
    }
    if (DISPLAY_MATH.test(line.trim())) return true;
    const quote = QUOTE.exec(line);
    if (!quote) { if (complete) this.#quote = null; return false; }
    const inner = this.#quote ?? new DrawingScan();
    if (complete) this.#quote = inner;
    return inner.line(quote[1]!, complete);
  }
}

/** The core's line for a move the agent asked for itself (`boite thread move`), drawn as a marker, not a message. */
export function movedBy(message: Message): MoveNotice | null {
  if (message.role !== 'system') return null;
  for (const part of message.parts) if (part.type === 'text' && part.moved?.by === 'agent') return part.moved;
  return null;
}

/** The core's line for a thread the agent started (`boite thread new`). */
export function startedFrom(message: Message): ThreadLink | null {
  if (message.role !== 'system') return null;
  for (const part of message.parts) if (part.type === 'text' && part.started) return part.started;
  return null;
}

/**
 * A move the user made that the agent hears of with the next prompt, for the
 * foot of the open thread: null once that prompt went (its own marker takes
 * over), after a move back, after a move the agent made, and for another thread.
 */
export function pendingMoveOf(thread: Pick<ThreadSummary, 'id' | 'moveNote'> | null, threadId: string): MoveNotice | null {
  if (!thread || thread.id !== threadId) return null;
  return thread.moveNote ?? null;
}

/** Everything the agent wrote in one turn, its tool cards left out: what a copy of the answer takes. */
export function turnAnswer(messages: readonly Message[], turnId: string): string {
  return messages
    .filter((message) => message.turnId === turnId && message.role === 'assistant')
    .flatMap((message) => message.parts.flatMap((part) => (part.type === 'text' ? [visibleAnswer(part.text).trim()] : [])))
    .filter(Boolean)
    .join('\n\n');
}

/** The newest turn's answer that has any text, or the empty string. */
export function lastAnswer(messages: readonly Message[]): string {
  // A turn with no text is read once, however many messages it spans.
  const read = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'assistant' || message.turnId === null || read.has(message.turnId)) continue;
    read.add(message.turnId);
    const text = turnAnswer(messages, message.turnId);
    if (text) return text;
  }
  return '';
}
