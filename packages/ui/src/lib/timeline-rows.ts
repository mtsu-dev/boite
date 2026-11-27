import type { MemoryEvent, Message, MessagePart } from '@boite/contracts';
import { promptText, visibleAnswer } from './message-display';
import { failedRun, failureKind } from './failed-attempts';
import { writtenPlan } from './plan';
import { textSlotEstimate } from './message-window';
import { placedPath } from './inline-view';
import { textRevision } from './text-revisions';

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
  /** Set on a row that draws one slice of a long text part, the part `from` (`TextSlice`). */
  text?: TextSlice;
}

/**
 * One slice of a long text: the shown text's characters `[start, end)`, to
 * its end when `end` is unset (the last slice, the one a streamed answer
 * still grows). A slice only draws its characters: what the answer means is
 * decided on the whole text when it is cut and carried here. A cut text is
 * never a written plan (`textPieces` leaves plans whole) nor narration (it is
 * longer than any). `pages` are the paths the lines on either side of its top
 * cut (`above`) and its bottom cut (`below`) place (`placedPath`): where one
 * names a page of the turn, the page stands at the cut and the bubbles on its
 * two sides do not join. Unset when none does.
 */
export interface TextSlice {
  start: number;
  end?: number;
  pages?: { above?: string[]; below?: string[] };
}

/**
 * A text part is cut into rows from this many characters: under it, a row is
 * a screen or two and cutting saves nothing. Measured with `bench/ui-frames.ts`
 * on 2026-11-15: rows of 2 KB from 4 KB opened the bench's answers fastest but
 * cost the most to scroll through, rows of 8 KB from 16 KB saved nothing on
 * open; 4 KB from 8 KB keeps most of the open and half the scroll cost.
 */
export const SPLIT_FROM = 8192;
/** The characters a row of a cut text holds at least before the next top-level block may start another. */
export const ROW_CHARS = 4096;

/** A line that continues a list, an indented block or a table: never the first line of a row. */
const CONTINUES = /^(?:[ \t]{2,}|\t|[-*+][ \t]|\d+[.)][ \t]|\|)/;

/**
 * Where a long text is cut into rows: the offsets of the lines that start a
 * new row, each the first line of a top-level block after a blank line, at
 * least `ROW_CHARS` after the row before it. Never inside a fence, a list, an
 * indented block or a table, and never on the line after a list. The renderer
 * has no reference links or footnotes, so a `[label]: …` line binds nothing
 * across a cut. Only whole lines decide, so the cuts of a streamed text are the cuts of
 * its prefix, and a row's id stays the same as more text arrives and once it
 * ends. Empty under `SPLIT_FROM`.
 */
export function textCuts(text: string): number[] {
  return new TextCutScan().slices(text).slice(1).map(slice => slice.start);
}

/** A trusted append only needs new lines. Completed lines determine the cuts and their page joins. */
class TextCutScan {
  #epoch: object | undefined;
  #length = 0;
  #lineStart = 0;
  #previousLine = '';
  #fence = '';
  #rowStart = 0;
  #blank = false;
  #afterList = false;
  #slices: TextSlice[] = [];

  slices(text: string, epoch?: object): TextSlice[] {
    if (epoch === undefined || epoch !== this.#epoch || text.length < this.#length) {
      this.#length = this.#lineStart = this.#rowStart = 0;
      this.#previousLine = this.#fence = '';
      this.#blank = this.#afterList = false;
      this.#slices = [];
    }
    this.#epoch = epoch;
    if (text.length < SPLIT_FROM || text.length === this.#length) return this.#slices;
    let slices = this.#slices;
    for (let end = text.indexOf('\n', this.#length); end >= 0; end = text.indexOf('\n', this.#lineStart)) {
      const start = this.#lineStart;
      const line = text.slice(start, end);
      const trimmed = line.trim();
      this.#lineStart = end + 1;
      if (this.#fence) {
        if (trimmed.startsWith(this.#fence) && trimmed.replaceAll(this.#fence[0]!, '') === '') this.#fence = '';
        this.#blank = false;
      } else {
        const continues = CONTINUES.test(line);
        if (this.#blank && trimmed && !this.#afterList && start - this.#rowStart >= ROW_CHARS && !continues) {
          const paths = cutPaths(this.#previousLine, line);
          if (slices === this.#slices) slices = slices.slice();
          const tail = slices.pop() ?? { start: 0 };
          slices.push({ ...tail, end: start, ...(paths ? { pages: { ...tail.pages, below: paths } } : {}) },
            paths ? { start, pages: { above: paths } } : { start });
          this.#rowStart = start;
        }
        this.#fence = /^(`{3,}|~{3,})/.exec(trimmed)?.[1] ?? '';
        if (trimmed) this.#afterList = continues;
        this.#blank = trimmed === '';
      }
      if (trimmed) this.#previousLine = line.trimEnd();
    }
    this.#length = text.length;
    return this.#slices = slices;
  }
}

function samePaths(a?: readonly string[], b?: readonly string[]): boolean {
  return a === b || !!a && !!b && a.length === b.length && a.every((path, i) => path === b[i]);
}

function samePages(a: TextSlice['pages'], b: TextSlice['pages']): boolean {
  return samePaths(a?.above, b?.above) && samePaths(a?.below, b?.below);
}

/**
 * The long text parts of an assistant message and their slices, the parts a
 * memory notice is anchored on and written plans left whole. A system
 * message is never cut: its note draws its mark beside the whole text.
 */
function textPieces(message: Message, scans: WeakMap<MessagePart, TextCutScan>, anchored?: ReadonlySet<number>): { part: number; slices: TextSlice[] }[] {
  if (message.role !== 'assistant') return [];
  const pieces: { part: number; slices: TextSlice[] }[] = [];
  message.parts.forEach((part, index) => {
    if (part.type !== 'text' || anchored?.has(index)) return;
    const text = part.text;
    if (text.length < SPLIT_FROM) return;
    const shown = visibleAnswer(text);
    // A written plan is drawn whole in its card, which copies and saves all of it.
    if (writtenPlan(shown)) return;
    let scan = scans.get(part);
    if (!scan) scans.set(part, scan = new TextCutScan());
    const slices = scan.slices(shown, textRevision(part));
    if (slices.length) pieces.push({ part: index, slices });
  });
  return pieces;
}

/** The paths the lines on either side of the cut at `at` place: the last line written above it and its first line. */
function pagesAt(text: string, at: number): string[] | undefined {
  const before = text.slice(0, at).trimEnd();
  const lineEnd = text.indexOf('\n', at);
  return cutPaths(before.slice(before.lastIndexOf('\n') + 1), text.slice(at, lineEnd < 0 ? undefined : lineEnd));
}

function cutPaths(above: string, below: string): string[] | undefined {
  const paths = [placedPath(above), placedPath(below)].filter((path): path is string => path !== null);
  return paths.length ? paths : undefined;
}

/** The slice `[start, end)` of the shown text `text`, with what its edges are decided on the whole text. */
export function textSlice(text: string, start: number, end?: number): TextSlice {
  const above = start > 0 ? pagesAt(text, start) : undefined;
  const below = end !== undefined ? pagesAt(text, end) : undefined;
  return { start, ...(end !== undefined ? { end } : {}), ...(above || below ? { pages: { ...(above ? { above } : {}), ...(below ? { below } : {}) } } : {}) };
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

type MessageShape = {
  cuts: number[];
  pieces: ReturnType<typeof textPieces>;
};

type Memo = <T>(read: () => T) => () => T;

/**
 * The rows of a timeline, and the same row objects from one call to the next
 * for the messages that did not change: a part arriving at the bottom of a
 * streaming message leaves every row above its last one as it was, so nothing
 * that draws them runs again.
 */
export class TimelineRows {
  readonly #scans = new WeakMap<MessagePart, TextCutScan>();
  readonly #failures = new WeakMap<Message, () => ReturnType<typeof failureKind>>();
  readonly #shapes = new WeakMap<Message, { events: MemoryEvent[] | undefined; read: () => MessageShape }>();
  #known = new Map<string, TimelineRow>();
  #rows: TimelineRow[] = [];
  #order = '';
  #changedFrom = 0;

  constructor(private readonly memo: Memo = read => read) {}

  #ensureFailure(message: Message): () => ReturnType<typeof failureKind> {
    let read = this.#failures.get(message);
    if (!read) this.#failures.set(message, read = this.memo(() => failureKind(message)));
    return read;
  }

  #ensureShape(message: Message, events: MemoryEvent[] | undefined): () => MessageShape {
    let shape = this.#shapes.get(message);
    if (!shape || shape.events !== events) {
      let previous: MessageShape | undefined;
      const read = this.memo(() => {
        const anchored = anchoredParts(events);
        const cuts = rowCuts(message, anchored);
        const pieces = textPieces(message, this.#scans, anchored);
        if (previous && previous.cuts.length === cuts.length && cuts.every((cut, at) => cut === previous!.cuts[at]) &&
          previous.pieces.length === pieces.length && pieces.every((piece, at) => previous!.pieces[at]?.part === piece.part && previous!.pieces[at]?.slices === piece.slices)) return previous;
        return previous = { cuts, pieces };
      });
      this.#shapes.set(message, shape = { events, read });
    }
    return shape.read;
  }

  /**
   * Prepare memoized readers for `timeline` without evaluating them. Reactive
   * callers run this in a separate derived from `build()` so newly created
   * deriveds are tracked and disconnected instead of orphaned on message state.
   */
  prepare(timeline: readonly Message[], memory?: ReadonlyMap<string, MemoryEvent[]>): void {
    for (let index = 0; index < timeline.length; index += 1) {
      const message = timeline[index]!;
      this.#ensureFailure(message);
      this.#ensureShape(message, memory?.get(message.id));
    }
  }

  #failure = (message: Message): ReturnType<typeof failureKind> => this.#ensureFailure(message)();

  #shape(message: Message, events: MemoryEvent[] | undefined): MessageShape {
    return this.#ensureShape(message, events)();
  }

  /** The ids of the last rows built, in order and joined: what tells a reordered list from the same one. */
  get order(): string { return this.#order; }
  /**
   * The first index the last build put a different row at, the count of rows
   * when it changed none. A row that grew or was cut weighs something else
   * until it is measured, so the window's totals are repaired from there.
   */
  get changedFrom(): number { return this.#changedFrom; }

  build(timeline: readonly Message[], memory?: ReadonlyMap<string, MemoryEvent[]>, breaks?: ReadonlyMap<string, unknown>): TimelineRow[] {
    let rows = this.#rows;
    let length = 0;
    let changedFrom = rows.length;
    const add = (id: string, message: Message, from: number, to: number, first: boolean, last: boolean, failures?: readonly Message[], text?: TextSlice): void => {
      const before = this.#known.get(id);
      const sameFailures = before?.failures === failures || !!failures && before?.failures?.length === failures.length && failures.every((item, i) => before.failures?.[i] === item);
      // The pages at a cut decide its joins: a replaced text that keeps its cuts can name other pages there.
      const sameText = before?.text?.start === text?.start && before?.text?.end === text?.end && samePages(before?.text?.pages, text?.pages);
      const row = before && before.message === message && before.from === from && before.to === to && before.first === first && before.last === last && sameFailures && sameText
        ? before : { id, message, from, to, first, last, ...(failures ? { failures } : {}), ...(text ? { text } : {}) };
      if (rows === this.#rows && rows[length] !== row) {
        changedFrom = length;
        rows = rows.slice(0, length);
      }
      if (rows !== this.#rows) rows.push(row);
      length++;
    };
    for (let index = 0; index < timeline.length; index += 1) {
      const message = timeline[index]!;
      const failures = failedRun(timeline, index, this.#failure, memory, breaks);
      if (failures) {
        const last = failures.at(-1)!;
        add(message.id, last, 0, last.parts.length, true, true, failures);
        index += failures.length - 1;
        continue;
      }
      // A long turn that ends on a long answer takes both cuts: the answer is sliced inside its rows of parts.
      const count = message.parts.length;
      const { cuts, pieces } = this.#shape(message, memory?.get(message.id));
      if (pieces.length) { sliceRows(message, count, pieces, cuts, add); continue; }
      if (cuts.length === 0) { add(message.id, message, 0, count, true, true); continue; }
      add(message.id, message, 0, cuts[0]!, true, false);
      cuts.forEach((from, index) => add(`${message.id}#${index + 1}`, message, from, cuts[index + 1] ?? count, false, index === cuts.length - 1));
    }
    this.#changedFrom = Math.min(changedFrom, length);
    // The same array while every row is the same object: what reads it has nothing to redo.
    if (rows === this.#rows) {
      if (length === rows.length) return rows;
      rows = rows.slice(0, length);
    }
    for (let index = this.#changedFrom; index < this.#rows.length; index++) this.#known.delete(this.#rows[index]!.id);
    for (let index = this.#changedFrom; index < rows.length; index++) this.#known.set(rows[index]!.id, rows[index]!);
    if (rows.length !== this.#rows.length || rows.some((row, index) => row.id !== this.#rows[index]?.id)) this.#order = rows.map(row => row.id).join('\0');
    this.#rows = rows;
    return rows;
  }
}

/** What `TimelineRows.build` adds a row with. */
type AddRow = (id: string, message: Message, from: number, to: number, first: boolean, last: boolean, failures?: readonly Message[], text?: TextSlice) => void;

/**
 * The rows of a message with long text parts: the parts before and between
 * them as rows of their own, cut again at `partCuts` (`rowCuts`) in a long
 * turn, then one row per slice of each long text. The first row keeps the
 * message's id; a slice is `<message>#<part>.<block>`, a row of parts
 * `<message>#<its first part>`.
 */
function sliceRows(message: Message, count: number, pieces: { part: number; slices: TextSlice[] }[], partCuts: readonly number[], add: AddRow): void {
  const spans: { id: string; from: number; to: number; text?: TextSlice }[] = [];
  const range = (from: number, to: number): void => {
    for (const at of [...partCuts.filter(cut => cut > from && cut < to), to]) {
      spans.push({ id: `${message.id}#${from}`, from, to: at });
      from = at;
    }
  };
  let from = 0;
  for (const { part, slices } of pieces) {
    if (part > from) range(from, part);
    slices.forEach((text, block) => spans.push({ id: `${message.id}#${part}.${block}`, from: part, to: part + 1, text }));
    from = part + 1;
  }
  if (from < count) range(from, count);
  spans.forEach((span, index) => add(index === 0 ? message.id : span.id, message, span.from, span.to, index === 0, index === spans.length - 1, undefined, span.text));
}

/**
 * The row of `messageId` that draws `part`, or its first row with no part
 * named. A long text cut in slices answers the slice that holds character
 * `offset` of its shown text, its first slice without one. -1 when the
 * message is not listed.
 */
export function rowIndexOf(rows: readonly TimelineRow[], messageId: string, part?: number, offset = 0): number {
  let at = rows.findIndex(row => row.id === messageId || row.failures?.some(message => message.id === messageId));
  if (at < 0 || part === undefined) return at;
  for (let next = rows[at + 1]; next?.message === rows[at]!.message && (next.from < part || (next.from === part && (next.text?.start ?? 0) <= offset)); next = rows[at + 1]) at += 1;
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

