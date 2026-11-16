import { featureOn } from './features.svelte';
import { prepareBlocks } from './markdown';
import { ESTIMATE, estimateSlot, slotClasses } from './message-window';
import { answerText, paragraphBlocks } from './message-display';
import { rowEstimate, shownText, type TimelineRow } from './timeline-rows';

/** What a row of the timeline costs before it is drawn: its estimate, and its Markdown rendered off the main thread. */

/** Under this many characters a page renders here cheaply enough: no worker for it. */
export const PREPARE_FROM = 16_384;

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

/** Rows a warm-up mounts per idle slice, on each side of the window. */
export const WARM_ROWS = 1;
/** How long a warm-up waits for an idle slice before it runs anyway, and the delay where the browser has none. */
export const WARM_WAIT_MS = 200;

/** Runs `run` in the browser's next idle slice, or after `WARM_WAIT_MS` at most; answers how to cancel it. */
export function whenIdle(run: () => void, wait = WARM_WAIT_MS): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => run(), { timeout: wait });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, wait);
  return () => clearTimeout(id);
}

/** Two rows that draw slices of one finished message, neither of them a gap. */
function sameAnswer(a: TimelineRow | undefined, b: TimelineRow | undefined): boolean {
  return !!a && !!b && !a.gap && !b.gap && a.message === b.message && a.message.state === 'complete';
}

/**
 * The slices of a long answer the window reaches into, mounted ahead of the
 * reader in idle time. A row of a cut answer at the window's edge leaves the
 * rest of its answer unmounted, and a wheel moving into them mounted one per
 * frame, each a slice of Markdown parsed and laid out mid-scroll. Here each
 * idle slice of the main thread mounts the next row of that answer on each
 * side (`WARM_ROWS`), until the whole answer is drawn: the wheel finds them
 * there. Only rows of the answers at the edges count, so what stays mounted is
 * at most two answers more than the window, and a row of another message
 * stops the warm-up.
 */
export class SliceWarmth {
  readonly #warm = new Set<string>();
  #pending: (() => void) | undefined;

  /** `[start, end)` widened through the rows of the edge answers mounted already. */
  widen(rows: readonly TimelineRow[], start: number, end: number): { start: number; end: number } {
    while (start > 0 && sameAnswer(rows[start - 1], rows[start]) && this.#warm.has(rows[start - 1]!.id)) start -= 1;
    while (end < rows.length && sameAnswer(rows[end - 1], rows[end]) && this.#warm.has(rows[end]!.id)) end += 1;
    return { start, end };
  }

  /** The rows a warm-up would mount next around `[start, end)`, one per side at most. */
  next(rows: readonly TimelineRow[], start: number, end: number): TimelineRow[] {
    const out: TimelineRow[] = [];
    for (let step = 0; step < WARM_ROWS && start > 0 && sameAnswer(rows[start - 1], rows[start]); step += 1) out.push(rows[--start]!);
    for (let step = 0; step < WARM_ROWS && end < rows.length && sameAnswer(rows[end - 1], rows[end]); step += 1) out.push(rows[end++]!);
    return out;
  }

  /**
   * Asks for an idle slice when the window has an edge answer to finish:
   * `read` gives the window then, `grew` is told once rows were added.
   */
  wake(read: () => { rows: readonly TimelineRow[]; start: number; end: number }, grew: () => void, idle = whenIdle): void {
    if (this.#pending) return;
    const { rows, start, end } = read();
    if (this.next(rows, start, end).length === 0) return;
    this.#pending = idle(() => {
      this.#pending = undefined;
      const now = read();
      const rows = this.next(now.rows, now.start, now.end);
      if (rows.length === 0) return;
      // Ids of answers far from the window are worth nothing; a reader who jumped away starts again.
      if (this.#warm.size > 256) this.#warm.clear();
      for (const row of rows) this.#warm.add(row.id);
      grew();
    });
  }

  stop(): void {
    this.#pending?.();
    this.#pending = undefined;
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
