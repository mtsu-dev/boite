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

  /** Sends the blocks of `rows` outside `[start, end)` not sent yet; answers how many characters went. */
  prepare(rows: readonly TimelineRow[], start: number, end: number, rich = featureOn('chat-artifacts') || featureOn('open-chat-links'), send = prepareBlocks): number {
    const blocks: string[] = [];
    let chars = 0;
    rows.forEach((row, index) => {
      const message = row.message;
      if (this.#sent.has(row) || (index >= start && index < end) || row.gap || message.role !== 'assistant' || message.state !== 'complete') return;
      this.#sent.add(row);
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
    void send(blocks, rich);
    return chars;
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
