import type { MemoryEvent, Message, MessagePart } from '@boite/contracts';
import { promptText, visibleAnswer } from './message-display';
import { failedRun } from './failed-attempts';
import { textSlotEstimate } from './message-window';

/**
 * What the timeline's window counts and measures. A message is one row, except
 * the kind a long agent session leaves: an assistant message that carries a
 * whole turn of work, a thousand tool calls and more with a paragraph between
 * each run of them. Drawn as one block it was all mounted whenever any of it
 * was near the viewport, tens of thousands of pixels of it, and each scroll
 * across its edge built or tore down every part at once. Such a message is
 * cut into rows of about `ROW_PARTS` parts, each one measured and windowed
 * like a message of its own (docs/internals/performance.md, "A long turn is many rows").
 *
 * A cut falls only in front of a paragraph the page draws. An activity run
 * never spans it, so the rows draw exactly what the whole message drew, and
 * the gap above a continuing row is always the one a paragraph takes under
 * whatever came before it (`BLOCK_GAP`).
 *
 * A long answer is the other kind: one text part of 30 KB of Markdown is one
 * row as tall as many screens, all of it parsed and laid out to show a screen
 * of it. From `SPLIT_FROM` characters its text is cut at top-level Markdown
 * blocks into rows of about `ROW_CHARS` (`textCuts`), each drawing its slice
 * of the text (`TimelineRow.text`), so the window skips the blocks off screen.
 */

/** The parts a row of a cut message holds before the next paragraph may start another. */
export const ROW_PARTS = 40;
/** A message is left whole up to this many parts: cutting it would save nothing. */
export const CUT_FROM = 64;

export interface TimelineRow {
  /** The message's id for a whole message and for the first row of a cut one, `<id>#<n>` for the rows after it. */
  id: string;
  message: Message;
  /** The parts this row draws, `[from, to)`. A whole message is `[0, parts.length)`. */
  from: number;
  to: number;
  /** Whether this is the first, and the last, row of its message. */
  first: boolean;
  last: boolean;
  /** Set on a row that stands for a stretch of the thread not held yet (`lib/history-gaps.ts`). */
  gap?: { from: number; count: number };
  /** Consecutive failed attempts, including their wake-ups, kept in one disclosure. */
  failures?: readonly Message[];
  /**
   * Set on a row that draws one slice of a long text part, the part `from`:
   * the shown text's characters `[start, end)`, to its end when `end` is unset
   * (the last slice, the one a streamed answer still grows).
   */
  text?: { start: number; end?: number };
}

/** A text part is cut into rows from this many characters: under it, a row is a screen or two and cutting saves nothing. */
export const SPLIT_FROM = 4096;
/** The characters a row of a cut text holds at least before the next top-level block may start another. */
export const ROW_CHARS = 2048;

/** A line that continues a list, an indented block or a table: never the first line of a row. */
const CONTINUES = /^(?:[ \t]{2,}|\t|[-*+][ \t]|\d+[.)][ \t]|\|)/;
/** A link or footnote definition: `[label]: …` or `[^note]: …`. */
const DEFINITION = /^ {0,3}\[(\^?[^\]\n]+)\]:/gm;

/**
 * Where a long text is cut into rows: the offsets of the lines that start a
 * new row, each the first line of a top-level block after a blank line, at
 * least `ROW_CHARS` after the row before it. Never inside a fence, a list, an
 * indented block or a table, never on the line after a list, and never between
 * a link or footnote definition and its first use: every cut lies before the
 * first `[label]` a definition names, so definitions and uses share the last
 * row. Only whole lines decide, so the cuts of a streamed text are the cuts of
 * its prefix, and a row's id stays the same as more text arrives and once it
 * ends. Empty under `SPLIT_FROM`.
 */
export function textCuts(text: string): number[] {
  if (text.length < SPLIT_FROM) return [];
  const cuts: number[] = [];
  let fence = '';
  let rowStart = 0;
  let blank = false;
  let afterList = false;
  for (let start = 0; start < text.length;) {
    const end = text.indexOf('\n', start);
    if (end < 0) break;
    const line = text.slice(start, end);
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith(fence) && trimmed.replaceAll(fence[0]!, '') === '') fence = '';
      blank = false;
    } else {
      if (blank && trimmed && !afterList && start - rowStart >= ROW_CHARS && !CONTINUES.test(line)) {
        cuts.push(start);
        rowStart = start;
      }
      const open = /^(`{3,}|~{3,})/.exec(trimmed);
      if (open) fence = open[1]!;
      if (trimmed) afterList = CONTINUES.test(line);
      blank = trimmed === '';
    }
    start = end + 1;
  }
  if (cuts.length === 0) return cuts;
  const labels = [...text.matchAll(DEFINITION)].map(match => `[${match[1]!.toLowerCase()}]`);
  if (labels.length === 0) return cuts;
  const lower = text.toLowerCase();
  const firstUse = Math.min(...labels.map(label => lower.indexOf(label)).filter(at => at >= 0));
  return cuts.filter(at => at <= firstUse);
}

/** The long text parts of a message and where each is cut, the parts a memory notice is anchored on left whole. */
function textPieces(message: Message, anchored?: ReadonlySet<number>): { part: number; cuts: number[] }[] {
  if (message.role === 'user') return [];
  const pieces: { part: number; cuts: number[] }[] = [];
  message.parts.forEach((part, index) => {
    if (part.type !== 'text' || part.text.length < SPLIT_FROM || anchored?.has(index)) return;
    const cuts = textCuts(shownText(message, part));
    if (cuts.length) pieces.push({ part: index, cuts });
  });
  return pieces;
}

/**
 * What one part of a cut message is worth in pixels before its row is
 * measured: a run of a dozen calls is one line and the paragraph after it
 * three or four, about 150 px for thirteen parts in the threads this was read
 * from. An estimate a row's real height replaces; closer than the 80 px a
 * whole message gets, it moves the scrollbar less as a scroll measures rows.
 */
const PART_ESTIMATE = 11;
/**
 * What a paragraph and the run under it are worth at least: a session that
 * writes a line before each call (ADEMark's 1,000 steps of a sentence and a
 * `Read`) draws about 116 px a step, ten times its two parts at
 * `PART_ESTIMATE`. Counted at 22 px, such a row was estimated at a fifth of
 * its height, and the window at the bottom mounted four of them where one
 * filled the screen.
 */
const PARAGRAPH_ESTIMATE = 100;

/** What a row weighs before it is measured: `whole` for a message drawn as one row. */
export function rowEstimate(row: TimelineRow, whole: number): number {
  if (row.first && row.last) return whole;
  if (row.text) {
    const part = row.message.parts[row.from];
    const length = part?.type === 'text' ? part.text.length : 0;
    return textSlotEstimate((row.text.end ?? length) - row.text.start);
  }
  let paragraphs = 0;
  for (let index = row.from; index < row.to; index += 1) if (row.message.parts[index]?.type === 'text') paragraphs += 1;
  return Math.max(whole, (row.to - row.from) * PART_ESTIMATE, paragraphs * PARAGRAPH_ESTIMATE);
}

/** The text an assistant or system message shows for a part: what `AssistantMessage` draws. */
export function shownText(message: Message, part: Extract<MessagePart, { type: 'text' }>): string {
  return message.role === 'system' ? promptText(part) : visibleAnswer(part.text);
}

/**
 * Where a message is cut: the indices of the parts that start a row after the
 * first, in order. Each is a paragraph the page draws, at least `ROW_PARTS`
 * parts after the row's own start, and never the last part: the one an answer
 * is still writing is not read here, so a streamed delta cuts nothing again.
 * A memory notice anchored on a part keeps its place in the run before it.
 */
export function rowCuts(message: Message, anchored?: ReadonlySet<number>): number[] {
  const parts = message.parts;
  const count = parts.length;
  if (count <= CUT_FROM || message.role === 'user') return [];
  const cuts: number[] = [];
  let at = ROW_PARTS;
  while (at < count - 1) {
    const part = parts[at];
    if (part?.type === 'text' && !anchored?.has(at) && shownText(message, part).trim().length > 0) {
      cuts.push(at);
      at += ROW_PARTS;
    } else at += 1;
  }
  return cuts;
}

/** The part indices the memory notices of a message are anchored on. */
function anchoredParts(events: readonly MemoryEvent[] | undefined): ReadonlySet<number> | undefined {
  if (!events?.length) return undefined;
  return new Set(events.flatMap(event => event.anchor ? [event.anchor.partIndex] : []));
}

/**
 * The rows of a timeline, and the same row objects from one call to the next
 * for the messages that did not change: a part arriving at the bottom of a
 * streaming message leaves every row above its last one as it was, so nothing
 * that draws them runs again.
 */
export class TimelineRows {
  #known = new Map<string, TimelineRow>();
  #rows: TimelineRow[] = [];
  #order = '';
  #changedFrom = 0;

  /** The ids of the last rows built, in order and joined: what tells a reordered list from the same one. */
  get order(): string { return this.#order; }
  /**
   * The first index the last build put a different row at, the count of rows
   * when it changed none. A row that grew or was cut weighs something else
   * until it is measured, so the window's totals are repaired from there.
   */
  get changedFrom(): number { return this.#changedFrom; }

  build(timeline: readonly Message[], memory?: ReadonlyMap<string, MemoryEvent[]>, breaks?: ReadonlyMap<string, unknown>): TimelineRow[] {
    const known = new Map<string, TimelineRow>();
    const rows: TimelineRow[] = [];
    let changedFrom = -1;
    const add = (id: string, message: Message, from: number, to: number, first: boolean, last: boolean, failures?: readonly Message[], text?: { start: number; end?: number }): void => {
      const before = this.#known.get(id);
      const sameFailures = before?.failures === failures || !!failures && before?.failures?.length === failures.length && failures.every((item, i) => before.failures?.[i] === item);
      const sameText = before?.text?.start === text?.start && before?.text?.end === text?.end;
      const row = before && before.message === message && before.from === from && before.to === to && before.first === first && before.last === last && sameFailures && sameText
        ? before : { id, message, from, to, first, last, ...(failures ? { failures } : {}), ...(text ? { text } : {}) };
      known.set(id, row);
      if (changedFrom < 0 && this.#rows[rows.length] !== row) changedFrom = rows.length;
      rows.push(row);
    };
    for (let index = 0; index < timeline.length; index += 1) {
      const message = timeline[index]!;
      const failures = failedRun(timeline, index, memory, breaks);
      if (failures) {
        const last = failures.at(-1)!;
        add(message.id, last, 0, last.parts.length, true, true, failures);
        index += failures.length - 1;
        continue;
      }
      const count = message.parts.length;
      const anchored = anchoredParts(memory?.get(message.id));
      const cuts = count > CUT_FROM ? rowCuts(message, anchored) : [];
      const pieces = cuts.length === 0 ? textPieces(message, anchored) : [];
      if (pieces.length) { sliceRows(message, pieces, add); continue; }
      if (cuts.length === 0) { add(message.id, message, 0, count, true, true); continue; }
      add(message.id, message, 0, cuts[0]!, true, false);
      cuts.forEach((from, index) => add(`${message.id}#${index + 1}`, message, from, cuts[index + 1] ?? count, false, index === cuts.length - 1));
    }
    this.#known = known;
    this.#changedFrom = changedFrom < 0 ? rows.length : changedFrom;
    // The same array while every row is the same object: what reads it has nothing to redo.
    if (changedFrom < 0 && rows.length === this.#rows.length) return this.#rows;
    this.#rows = rows;
    this.#order = rows.map(row => row.id).join('\0');
    return rows;
  }
}

/** What `TimelineRows.build` adds a row with. */
type AddRow = (id: string, message: Message, from: number, to: number, first: boolean, last: boolean, failures?: readonly Message[], text?: { start: number; end?: number }) => void;

/**
 * The rows of a message with long text parts: the parts before and between
 * them as rows of their own, then one row per slice of each long text. The
 * first row keeps the message's id; a slice is `<message>#<part>.<block>`,
 * the parts after a long text `<message>#<part>`.
 */
function sliceRows(message: Message, pieces: { part: number; cuts: number[] }[], add: AddRow): void {
  const spans: { id: string; from: number; to: number; text?: { start: number; end?: number } }[] = [];
  let from = 0;
  for (const { part, cuts } of pieces) {
    if (part > from) spans.push({ id: `${message.id}#${from}`, from, to: part });
    const bounds = [0, ...cuts];
    bounds.forEach((start, block) => {
      const end = bounds[block + 1];
      spans.push({ id: `${message.id}#${part}.${block}`, from: part, to: part + 1, text: end === undefined ? { start } : { start, end } });
    });
    from = part + 1;
  }
  if (from < message.parts.length) spans.push({ id: `${message.id}#${from}`, from, to: message.parts.length });
  spans.forEach((span, index) => add(index === 0 ? message.id : span.id, message, span.from, span.to, index === 0, index === spans.length - 1, undefined, span.text));
}

/** The row of `messageId` that draws `part`, or its first row with no part named. -1 when the message is not listed. */
export function rowIndexOf(rows: readonly TimelineRow[], messageId: string, part?: number): number {
  let at = rows.findIndex(row => row.id === messageId || row.failures?.some(message => message.id === messageId));
  if (at < 0 || part === undefined) return at;
  while (rows[at + 1]?.message === rows[at]!.message && rows[at + 1]!.from <= part) at += 1;
  return at;
}

/**
 * How an assistant message that carries on the turn of the row above joins it.
 * A provider can open a new message in the middle of a turn, and the gap
 * between messages then cut one run of work in two. Joined, the seam takes the
 * gap the parts of one message take: `block` where text meets it, the space a
 * paragraph keeps, `part` between two runs of activity. Null for any other row.
 */
export function seam(previous: TimelineRow | undefined, row: TimelineRow): 'part' | 'block' | null {
  if (!previous || !row.first || row.message.role !== 'assistant') return null;
  if (previous.message.turnId !== row.message.turnId || previous.message.id === row.message.id) return null;
  // A system wake-up names the work directly below it, including a failed turn.
  if (previous.message.role === 'system') return 'block';
  if (previous.message.role !== 'assistant') return null;
  const shown = (part: MessagePart) => !(part.type === 'text' && part.text.trim() === '');
  const lead = row.message.parts.find(shown);
  const tail = previous.message.parts.slice(previous.from, previous.to).findLast(shown);
  return lead?.type === 'text' || tail?.type === 'text' ? 'block' : 'part';
}
