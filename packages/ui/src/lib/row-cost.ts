import { featureOn } from './features.svelte';
import { prepareBlocks } from './markdown';
import { ESTIMATE, estimateSlot, slotClasses } from './message-window';
import { answerText, paragraphBlocks } from './message-display';
import { rowEstimate, shownText, type TimelineRow } from './timeline-rows';

/** What a row of the timeline costs before it is drawn: its estimate, and its Markdown rendered off the main thread. */

/** Under this many characters a page renders here cheaply enough: no worker for it. */
const PREPARE_FROM = 16_384;

/**
 * A page of history renders its Markdown in a worker (`prepareBlocks`): the
 * finished answers of the rows the window has not drawn are split into the
 * blocks `Prose` draws and sent once, and a row scrolled to later inserts
 * their HTML from the cache. The rows on screen render on the main thread as
 * before, and so does any row when the worker is missing or slower than 50 ms.
 * The message still streaming is never sent.
 */
export class HistoryPrepare {
  readonly #sent = new WeakSet<TimelineRow>();

  /**
   * Sends the blocks of `rows` outside `[start, end)` not sent yet; answers how
   * many characters went. The slices of the messages at the window's edges go
   * first, in a batch of their own: they are the rows `SliceWarmth` mounts next,
   * and the worker answers them before it starts on the rest of the page.
   */
  prepare(rows: readonly TimelineRow[], start: number, end: number, rich = featureOn('chat-artifacts') || featureOn('open-chat-links'), send = prepareBlocks): number {
    const near: string[] = [], far: string[] = [];
    let chars = 0;
    const edges = new Set([rows[start]?.message, rows[end - 1]?.message]);
    rows.forEach((row, index) => {
      const message = row.message;
      if (this.#sent.has(row) || (index >= start && index < end) || row.gap || message.role !== 'assistant' || message.state !== 'complete') return;
      this.#sent.add(row);
      const blocks = edges.has(message) ? near : far;
      for (let at = row.from; at < row.to; at += 1) {
        const part = message.parts[at];
        if (part?.type !== 'text') continue;
        const shown = shownText(message, part);
        const text = row.text && at === row.from ? shown.slice(row.text.start, row.text.end) : shown;
        chars += text.length;
        blocks.push(...paragraphBlocks(answerText(text, false), false));
      }
    });
    if (chars < PREPARE_FROM) return 0;
    if (near.length) void send(near, rich);
    if (far.length) void send(far, rich);
    return chars;
  }
}

/** What mounting one slice is taken to cost until one has been timed, in ms: an idle period with less left mounts nothing. */
export const WARM_SLICE_MS = 12;
/** The delay between two steps where the browser has no idle callbacks. */
const WARM_WAIT_MS = 200;
/** An idle period lasts 50 ms at most: a slice timed over this still mounts, alone, in a whole one. */
const IDLE_MAX_MS = 45;

/**
 * Runs `run` in the browser's next idle period, with no timeout: a busy main thread mounts nothing. `left` answers the
 * ms the period has left. Where the browser has none, `run` comes after `WARM_WAIT_MS` with room for one step.
 * Answers how to cancel it.
 */
export function whenIdle(run: (left: () => number) => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(deadline => run(() => deadline.timeRemaining()));
    return () => cancelIdleCallback(id);
  }
  let given = false;
  const id = setTimeout(() => run(() => (given ? 0 : ((given = true), Infinity))), WARM_WAIT_MS);
  return () => clearTimeout(id);
}

/**
 * A row drawing a slice of a finished cut answer. Off screen, it skips its style and layout
 * (`content-visibility: auto`) and stands for `sliceBox`: its slot as measured or estimated, its gap
 * taken off. Its paint clip reaches up through that gap (`overflow-clip-margin`), where the bubble
 * joins the slice above. A slice the warm-up mounted ahead of the reader is laid out in idle time (`layOut`).
 */
export function isSlice(row: TimelineRow): boolean {
  return !!row.text && !row.gap && row.message.state === 'complete';
}

export function sliceBox(row: TimelineRow, slot: number, gap: number): string | undefined {
  return isSlice(row) ? `auto ${Math.max(0, Math.round(slot - gap))}px` : undefined;
}

/** A warmed slice drawn ahead of the reader: styled and laid out now, in idle time, not as the wheel reaches it. */
export function layOut(node: HTMLElement | undefined): void {
  if (!node?.isConnected) return;
  node.style.contentVisibility = 'visible';
  void node.offsetHeight;
}

/** Two rows that draw slices of one text part of a finished message: the rows of a turn's work are no slices. */
function sameAnswer(a: TimelineRow | undefined, b: TimelineRow | undefined): boolean {
  return !!a && !!b && isSlice(a) && isSlice(b) && a.message === b.message && a.from === b.from;
}

type RowWindow = { rows: readonly TimelineRow[]; start: number; end: number };

/** Warmed ids kept before those out of the window are forgotten. */
const WARM_KEEP = 256;

/**
 * The slices of a long answer the window reaches into, mounted ahead of the
 * reader in idle time. A row of a cut answer at the window's edge leaves the
 * rest of its answer unmounted, and a wheel moving into them mounted one per
 * frame, each a slice of Markdown parsed and laid out mid-scroll. Here the
 * browser's idle periods do it in two steps per slice: `grow` mounts the next
 * row of that answer (a slice off screen skips its style and layout,
 * `content-visibility: auto`), then `lay` styles and lays it out. A step runs
 * only while the period has more time left than the last step took (`grow`
 * runs the mount's effects at once, so it is timed whole), until the whole answer is drawn: the wheel
 * finds it there. Below the window first, where a reader at the top goes.
 * Nothing warms until two frames after the first wake that had a slice to
 * warm: the opened thread has painted. Only slices of one text part
 * of the answers at the edges count, so what stays mounted is at most two
 * answers more than the window, and a row of another message stops it.
 */
export class SliceWarmth {
  readonly #warm = new Set<string>();
  #unlaid: string[] = [];
  #pending: (() => void) | undefined;
  #ready = false;
  #cost = WARM_SLICE_MS;
  #wake: (() => void) | undefined;
  #settling = false;

  /** `frames` runs its callback once the opened thread has painted: two frames after the first wake with rows to warm. */
  constructor(private readonly frames: (run: () => void) => void = run => requestAnimationFrame(() => requestAnimationFrame(run))) {}

  /** `[start, end)` widened through the rows of the edge answers mounted already. */
  widen(rows: readonly TimelineRow[], start: number, end: number): { start: number; end: number } {
    while (start > 0 && sameAnswer(rows[start - 1], rows[start]) && this.#warm.has(rows[start - 1]!.id)) start -= 1;
    while (end < rows.length && sameAnswer(rows[end - 1], rows[end]) && this.#warm.has(rows[end]!.id)) end += 1;
    return { start, end };
  }

  /** The row a warm-up would mount next around `[start, end)`: below the window first. */
  next(rows: readonly TimelineRow[], start: number, end: number): TimelineRow | undefined {
    if (end < rows.length && sameAnswer(rows[end - 1], rows[end])) return rows[end];
    if (start > 0 && sameAnswer(rows[start - 1], rows[start])) return rows[start - 1];
    return undefined;
  }

  /** What one step is counted at: the last ones timed, at most a whole idle period. */
  get cost(): number {
    return Math.min(this.#cost, IDLE_MAX_MS);
  }

  /** The opened thread has painted: idle periods may mount now. */
  ready(): void {
    this.#ready = true;
    this.#wake?.();
  }

  /** Nothing warms before the list has painted what it opened on. */
  #settle(): void {
    if (this.#settling) return;
    this.#settling = true;
    this.frames(() => this.ready());
  }

  /**
   * Asks for an idle period when the window has an edge answer to finish or a
   * warmed row to lay out: `read` gives the window then, `grow` mounts the rows
   * added at once, `lay` styles and lays out the row of that id if it is still mounted.
   */
  wake(read: () => RowWindow, grow: () => void, lay: (id: string) => void, idle = whenIdle, now = () => performance.now()): void {
    this.#wake = () => this.wake(read, grow, lay, idle, now);
    if (this.#pending) return;
    if (!this.#unlaid.length) { const { rows, start, end } = read(); if (!this.next(rows, start, end)) return; }
    if (!this.#ready) return this.#settle();
    this.#pending = idle(left => {
      this.#pending = undefined;
      while (left() > this.cost) {
        const began = now();
        const id = this.#unlaid.shift();
        if (id !== undefined) lay(id);
        else {
          const { rows, start, end } = read();
          const row = this.next(rows, start, end);
          if (!row) return;
          // Ids of answers far from the window are worth nothing; a reader who jumped away starts again.
          // The window's own warmed slices stay: dropped, it would shrink and mount them again, never reaching the end.
          if (this.#warm.size > WARM_KEEP) this.#keep(rows.slice(start, end));
          this.#warm.add(row.id);
          this.#unlaid.push(row.id);
          grow();
        }
        this.#cost = Math.max(now() - began, this.#cost * 0.75);
      }
      this.wake(read, grow, lay, idle, now);
    });
  }

  /** Forgets the warmed ids but those of `rows`. */
  #keep(rows: readonly TimelineRow[]): void {
    const kept = rows.filter(row => this.#warm.has(row.id)).map(row => row.id);
    this.#warm.clear();
    for (const id of kept) this.#warm.add(id);
  }

  stop(): void {
    this.#pending?.();
    this.#pending = undefined;
    this.#wake = undefined;
  }
}

/**
 * What the window counts a row at until it is measured, taken once per row:
 * the means of `slotClasses` move as rows are measured, and an unmeasured row
 * that changed its weight under the totals would move the rows below it with
 * nothing resized. A row of a cut message counts its own parts, not its whole
 * message's text; a gap row is what `gapHeight` makes of its missing messages.
 */
export class RowEstimates {
  readonly #taken = new WeakMap<TimelineRow, number>();
  constructor(private readonly gapHeight: (count: number) => number) {}

  of(row: TimelineRow): number {
    if (row.gap) return this.gapHeight(row.gap.count);
    let known = this.#taken.get(row);
    if (known === undefined) {
      known = rowEstimate(row, row.first && row.last ? estimateSlot(row.message) : ESTIMATE);
      this.#taken.set(row, known);
    }
    return known;
  }

  /** A whole message measured: its class learns the height. */
  learn(row: TimelineRow | undefined, height: number): void {
    if (row && row.first && row.last && !row.gap && !row.failures) slotClasses.learn(row.message, height);
  }
}
