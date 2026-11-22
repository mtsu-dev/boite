import type { Message } from '@boite/contracts';

/** What the window lists: a message, or one row of a message cut in several (`timeline-rows.ts`). */
type Slot = { readonly id: string };

/**
 * What the window has cost since the page loaded: one count per recompute of
 * the slice, one per slot height read, one per walk over the tool calls of the
 * turns that end on screen. The bench tests in `MessageList.test.ts` read them
 * to prove they stay flat while a message streams and while a scroll stays
 * inside the rows drawn; nothing else does, and none is reactive.
 */
export const windowStats = { recomputes: 0, slots: 0, turnFiles: 0 };

/** Under this many messages the list renders whole: a window would cost more than it saves. */
export const WINDOW_FROM = 24;
/** Messages kept rendered above and below the viewport, so a scroll finds them already there. */
export const OVERSCAN = 4;
/** What a message's slot is worth before it has been measured. */
export const ESTIMATE = 80;
/** The column's --chat-message-gap in app.css, included in each measured slot. */
export const GAP = 20;
/**
 * --chat-block-gap in app.css: what a row that continues a cut message, or a
 * message that carries on its turn, keeps above it instead. One gap between
 * message, tool run, result and decision.
 */
export const BLOCK_GAP = 12;

/**
 * The gap a measured row keeps above it, part of its slot: the column's, or the
 * block gap of a row joined to the one above (`seam` in timeline-rows, or a cut
 * message's rest).
 */
export function slotGap(seam: string | null | undefined, rest: boolean): number {
  return seam || rest ? BLOCK_GAP : GAP;
}

/**
 * Whether a row's slot was measured with another gap than it now keeps. A
 * seam can change with nothing resizing, when an older page lands above the
 * row: the row must be measured again.
 */
export function gapChanged(node: HTMLElement, seam: string | null, rest: boolean): boolean {
  const measured = node.dataset['gap'];
  return measured !== undefined && Number(measured) !== slotGap(seam, rest);
}
/** A prompt's picture before it is opened: `UserMessage`'s thumbnail height. */
export const THUMB_HEIGHT = 88;
/** What the pictures' row adds besides them: its margin and the frames. */
const THUMB_ROW = 10;

/** A first guess for a class never measured: a line of about `LINE_CHARS` characters is `LINE_HEIGHT` px, under `SLOT_FRAME` px of frame. */
const LINE_CHARS = 90;
const LINE_HEIGHT = 24;
const SLOT_FRAME = 56;

/** The characters of text a message carries, and whether it carries anything else. */
function textWeight(message: Message): { chars: number; mixed: boolean } {
  let chars = 0;
  let mixed = false;
  for (const part of message.parts) {
    if (part.type === 'text') chars += part.text.length;
    else mixed = true;
  }
  return { chars, mixed };
}

/**
 * The measured heights of the session by class of message: its role, whether
 * it carries more than text, and the log2 of its characters. A 30 KB answer and
 * a one-line reply were both worth `ESTIMATE` until measured, so a page of long
 * answers was summed at a few hundred pixels where it filled screens: the
 * scrollbar jumped as rows were measured and the window mounted many rows for
 * the one that filled the view. A class measured once is worth the mean of
 * what it measured since; one never measured, its characters as lines.
 */
export class SlotClasses {
  readonly #sums = new Map<string, { total: number; count: number }>();

  static key(message: Message): string {
    const { chars, mixed } = textWeight(message);
    return `${message.role}${mixed ? '+' : ''}${Math.floor(Math.log2(chars + 1))}`;
  }

  learn(message: Message, height: number): void {
    if (pictured(message)) return;
    const key = SlotClasses.key(message);
    const sum = this.#sums.get(key);
    if (sum) { sum.total += height; sum.count += 1; } else this.#sums.set(key, { total: height, count: 1 });
  }

  /** The mean measured for the message's class, undefined while none is. */
  mean(message: Message): number | undefined {
    const sum = this.#sums.get(SlotClasses.key(message));
    return sum ? Math.round(sum.total / sum.count) : undefined;
  }

  clear(): void { this.#sums.clear(); }
}

/** The classes the page has measured since it loaded. */
export const slotClasses = new SlotClasses();

function pictured(message: Message): boolean {
  return message.role === 'user' && message.parts.some(part => part.type === 'image');
}

/**
 * What a message is worth before it is measured: the mean of its class
 * (`SlotClasses`), else its text as lines, never under `ESTIMATE`. A prompt's
 * pictures add their one row of thumbnails on top of `ESTIMATE`: left out, a
 * prompt with screenshots grew once on screen, and everything below the
 * reader moved by the difference.
 */
export function estimateSlot(message: Message, classes: SlotClasses = slotClasses): number {
  if (pictured(message)) return ESTIMATE + THUMB_HEIGHT + THUMB_ROW;
  const mean = classes.mean(message);
  if (mean !== undefined) return mean;
  return Math.max(ESTIMATE, SLOT_FRAME + Math.ceil(textWeight(message).chars / LINE_CHARS) * LINE_HEIGHT);
}

/** What a row drawing `chars` characters of one answer is worth before it is measured: its lines under the block gap. */
export function textSlotEstimate(chars: number): number {
  return BLOCK_GAP + Math.ceil(chars / LINE_CHARS) * LINE_HEIGHT;
}

// -- the running totals ------------------------------------------------------
// `sums[i]` is the height of everything above message `i`. A spacer is then
// one subtraction and the slice one bisection, instead of the walk over every
// message the window used to do on each recompute, streaming deltas included.

export interface SlotIndex {
  order: string;
  sums: readonly number[];
  positions: ReadonlyMap<string, number>;
}

export class SlotTotals<S extends Slot = Slot> {
  sums: number[] = [0];
  /** What `sums` was built on: how many messages there were, and the id at the head. */
  sumsCount = 0;
  sumsHead = '';
  sumsOrder = '';
  /** The lowest index a measurement invalidated. Repaired from there on the next read. */
  dirty = 0;
  /** Where each message sits, so a measurement finds its index without scanning. */
  readonly positions = new Map<string, number>();

  /**
   * `heights` holds the measured slot heights by row id. What is not in it is
   * worth `estimate`: ESTIMATE here, `estimateSlot` and a cut row's own count
   * of parts in the timeline.
   */
  constructor(private readonly heights: Map<string, number>, private readonly estimate: (slot: S) => number = () => ESTIMATE) {}

  save(limit: number): SlotIndex | undefined {
    if (!this.sumsCount || this.sumsCount > limit || this.dirty < this.sumsCount) return;
    return { order: this.sumsOrder, sums: this.sums.slice(), positions: new Map(this.positions) };
  }

  restore(index: SlotIndex, list: readonly S[], order: string): void {
    if (index.order !== order || index.sums.length !== list.length + 1) return;
    this.sums = index.sums.slice();
    // The totals may have served another thread since: its ids do not stay behind.
    this.positions.clear();
    for (const [id, at] of index.positions) this.positions.set(id, at);
    this.sumsCount = this.dirty = list.length;
    this.sumsHead = list[0]?.id ?? '';
    this.sumsOrder = order;
  }

  /** What a row weighs until it is measured. */
  estimateOf(slot: S | undefined): number {
    return slot ? this.estimate(slot) : ESTIMATE;
  }

  slotAt(list: readonly S[], index: number): number {
    windowStats.slots += 1;
    const slot = list[index];
    if (!slot) return ESTIMATE;
    return this.heights.get(slot.id) ?? this.estimate(slot);
  }

  rebuild(list: readonly S[], timelineOrder: string): void {
    this.sums = new Array<number>(list.length + 1);
    this.sums[0] = 0;
    this.positions.clear();
    for (let i = 0; i < list.length; i += 1) {
      const message = list[i];
      if (message) this.positions.set(message.id, i);
      this.sums[i + 1] = (this.sums[i] ?? 0) + this.slotAt(list, i);
    }
    this.sumsCount = list.length;
    this.sumsHead = list[0]?.id ?? '';
    this.sumsOrder = timelineOrder;
    this.dirty = list.length;
  }

  /**
   * The totals for this list. A page prepended above the window moves every
   * index and starts the array again; messages arriving at the bottom extend
   * it; a height that moved repairs the totals from its own index down, never
   * from the top.
   */
  totals(list: readonly S[], timelineOrder: string): number[] {
    const head = list[0]?.id ?? '';
    const append = list.length > this.sumsCount && timelineOrder.startsWith(this.sumsOrder + '\0');
    if (head !== this.sumsHead || list.length < this.sumsCount || (!append && timelineOrder !== this.sumsOrder)) {
      this.rebuild(list, timelineOrder);
      return this.sums;
    }
    if (list.length > this.sumsCount) {
      this.sums.length = list.length + 1;
      if (this.sumsCount < this.dirty) this.dirty = this.sumsCount;
      for (let i = this.sumsCount; i < list.length; i += 1) {
        const message = list[i];
        if (message) this.positions.set(message.id, i);
      }
      this.sumsCount = list.length;
    }
    for (let i = this.dirty; i < list.length; i += 1) this.sums[i + 1] = (this.sums[i] ?? 0) + this.slotAt(list, i);
    this.dirty = list.length;
    this.sumsOrder = timelineOrder;
    return this.sums;
  }

  /** Where a message sits now, off the map the totals keep; a miss falls back to a scan. */
  indexOf(timeline: readonly S[], id: string): number {
    const at = this.positions.get(id);
    if (at !== undefined && timeline[at]?.id === id) return at;
    return timeline.findIndex((message) => message.id === id);
  }
}

/**
 * The observed sizes that still count once their frame comes. A row the window
 * dropped since the observer ran keeps the box it reported: discarding it left
 * the row's slot at the estimate, so the spacer that replaced it was shorter
 * than the row, the browser's scroll anchoring moved the list, the window
 * mounted the row again for one frame, and the cycle never ended. A detached
 * row counts only while its message is still `listed` and no element on screen
 * reports the same message.
 */
export function measurable(entries: ResizeObserverEntry[], listed: (id: string) => boolean): ResizeObserverEntry[] {
  const mid = (entry: ResizeObserverEntry) => (entry.target as HTMLElement).dataset?.['mid'];
  const shown = new Set(entries.filter(entry => entry.target.isConnected).map(mid));
  return entries.filter((entry) => {
    if (entry.target.isConnected) return true;
    const id = mid(entry);
    return !!id && !shown.has(id) && (entry.borderBoxSize?.[0]?.blockSize ?? 0) > 0 && listed(id);
  });
}

/** One computed window: the rows drawn, the first one on screen, and what the two spacers weigh. */
export interface WindowView { start: number; end: number; first: number; above: number; below: number }

/**
 * `next`, or `previous` itself when it says the same thing. A scroll inside
 * the rows already drawn then hands back the very object the page was built
 * from, and nothing that reads the window runs again: the slice, the turns it
 * shows, the effects that follow its spacers.
 */
export function sameView(previous: WindowView | undefined, next: WindowView): WindowView {
  return previous && previous.start === next.start && previous.end === next.end && previous.first === next.first
    && previous.above === next.above && previous.below === next.below ? previous : next;
}

/** The last message whose top is at or above `at`. The totals only ever grow. */
export function atOrBefore(total: number[], count: number, at: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((total[mid] ?? 0) <= at) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The first message at or after `from` whose top reaches `at`, or the end of the list. */
export function reaches(total: number[], count: number, from: number, at: number): number {
  let low = from;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((total[mid] ?? 0) >= at) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Where the rows drawn at the bottom of the list start: up to `rows` above the
 * first one on screen, `first`, but no further once `room` pixels are drawn
 * above the view's top, `top`. A row as tall as several screens, a long turn's
 * row of paragraphs and calls, is overscan enough on its own: the rows above it
 * would be thousands of pixels of offscreen DOM, built for nothing on every
 * open (docs/internals/performance.md, "A long turn is many rows").
 */
export function overscanAbove(total: number[], first: number, top: number, room: number, rows: number): number {
  let start = first;
  while (start > 0 && first - start < rows && top - (total[start] ?? 0) < room) start -= 1;
  return start;
}

/** Keeps in each of `held` only the ids `lists` still carry: the heights and rises of rows `releaseOlder` took off the head go. */
export function keepOnly(held: readonly (Map<string, unknown> | Set<string>)[], ...lists: readonly (readonly { id: string }[])[]): void {
  const ids = new Set(lists.flatMap((list) => list.map((row) => row.id)));
  for (const kept of held) for (const id of [...kept.keys()]) if (!ids.has(id)) kept.delete(id);
}
