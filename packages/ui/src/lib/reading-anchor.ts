import type { ReadingPosition } from './store/reading-pages.svelte';
import type { SlotTotals } from './message-window';
import type { TimelineRow } from './timeline-rows';

/**
 * The row at the top of the reader's view and how far its top is from the
 * list's. `message` is the message that row belongs to: a long message is cut
 * in several rows (`timeline-rows.ts`), and a saved position names the message
 * for the store and the core, with the row the offset is measured from.
 */
export interface RowAnchor { id: string; offset: number; message?: string }

/**
 * Where the reader is in a timeline, read from the rows on the page and put
 * back after what moves them: a measured height, a page prepended, a thread
 * opened again where it was left.
 */
export class ReadingAnchor {
  current: RowAnchor | undefined;
  /** A saved place is still being put back: nothing reads a new one until the reader moves. */
  restoring: boolean;
  /**
   * A page landed around the reader, who keeps the row read as it landed, to
   * the fraction of a pixel. The browser snaps every scroll to a whole pixel,
   * its own anchoring too: an anchor read again after each correction took
   * each snap's remainder in, and a landing moved the text 1.23 px on a phone.
   */
  held = false;
  /** The rows on the page by id, kept by the list as it mounts them: an anchor is found without searching every node of the thread. */
  readonly nodes = new Map<string, HTMLElement>();
  #frame = 0;

  constructor(saved: ReadingPosition | undefined) {
    this.current = saved?.anchor ? { id: saved.anchor.row ?? saved.anchor.id, offset: saved.anchor.offset, message: saved.anchor.id } : undefined;
    this.restoring = Boolean(saved?.anchor && !saved.pinned);
  }

  /** Restore the saved heights and locate the reader within the current rows. */
  restore(saved: ReadingPosition | undefined, slots: SlotTotals<TimelineRow>, rows: TimelineRow[], order: string, revision: string | undefined): number {
    if (!saved) return 0;
    if (saved.slots && (saved.rows?.deref() === rows || revision && saved.revision === revision)) {
      slots.restore(saved.slots, rows, order);
    }
    const anchor = this.current;
    if (saved.pinned || !anchor) return saved.top;
    const at = rows.findIndex(row => row.id === anchor.id);
    return at < 0 ? saved.top : Math.max(0, (slots.totals(rows, order)[at] ?? 0) - anchor.offset);
  }

  /** Reads the anchor: the first row of `column`, whose children the rows are, that reaches the viewport. */
  remember(viewport: HTMLElement | undefined, column: HTMLElement | undefined, estimate?: HTMLElement): void {
    this.cancelPending();
    if (!viewport?.isConnected || !viewport.clientHeight || this.restoring || this.held || !column) return;
    const top = viewport.getBoundingClientRect().top;
    const start = estimate?.parentElement === column ? estimate : column.firstElementChild;
    for (let node = start; node; node = node.nextElementSibling) {
      const visible = visibleRow(node, top);
      if (!visible) continue;
      this.current = visible;
      // The slot uses estimated heights. Check back in case it put the first
      // visible row before the candidate. Spacers and gap rows cannot anchor.
      for (let previous = node.previousElementSibling; previous; previous = previous.previousElementSibling) {
        if (!(previous instanceof HTMLElement) || !previous.dataset['mid']) continue;
        const earlier = visibleRow(previous, top);
        if (!earlier) break;
        this.current = earlier;
      }
      return;
    }
  }

  schedule(remember: () => void): void {
    if (!this.#frame) this.#frame = requestAnimationFrame(remember);
  }

  cancelPending(): void {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** Keeps `anchor` until the reader moves it (`release`). */
  hold(anchor: RowAnchor): void {
    this.current = anchor;
    this.held = true;
  }

  /** A scroll that took the held row more than 2 px away, or off the page, is the reader's: the anchor is read again. */
  release(viewport: HTMLElement): void {
    if (!this.held) return;
    const drift = this.current ? this.drift(viewport, this.current) : null;
    if (drift === null || Math.abs(drift) > 2) this.held = false;
  }

  /** How far `anchor`'s row sits from where it was read, null when it is not on the page. */
  drift(viewport: HTMLElement, anchor: RowAnchor): number | null {
    const node = this.nodes.get(anchor.id);
    if (!node?.isConnected) return null;
    return node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
  }

  /** What a reading position keeps: the message, which the store asks the core the page around, and the row of it that was on top. */
  saved(): ReadingPosition['anchor'] {
    const anchor = this.current;
    if (!anchor) return undefined;
    const message = anchor.message ?? anchor.id;
    return { id: message, offset: anchor.offset, ...(message !== anchor.id ? { row: anchor.id } : {}) };
  }
}

function visibleRow(node: Element, top: number): RowAnchor | undefined {
  if (!(node instanceof HTMLElement)) return undefined;
  const id = node.dataset['mid'];
  if (!id) return undefined;
  const box = node.getBoundingClientRect();
  if (box.bottom > top) return { id, offset: box.top - top, message: node.dataset['message'] ?? id };
  return undefined;
}
