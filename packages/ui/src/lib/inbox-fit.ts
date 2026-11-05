/**
 * What the home's Inbox (home/Inbox.svelte) draws in the room its column
 * really has: how many Needs you cards before `See all`, and whether the
 * "Working now" lane opens by itself. Needs you takes the room first, from
 * three cards up to six; the work then opens when its drawn rows (five at
 * most, then the More line) fit in what is left. Nothing it opens makes the
 * column scroll.
 */

/** Rows shown before `See all`. */
export const WORKING_ROWS = 5;
/** A working row's height (`.row`'s min-height), and the `See all` line under five. */
export const WORKING_ROW_HEIGHT = 34;
export const MORE_HEIGHT = 34;
/** Needs you cards the home always shows, and the most the room can add to them before `See all`. */
export const NEEDS_CARDS = 3;
export const NEEDS_CARDS_MAX = 6;
/** A card's height (`.card`'s min-height) and the list's gap: the pitch used when the layout gives none. */
export const CARD_PITCH = 66;

/** How tall the open work is: up to five rows, then the `See all` line. */
export function workingHeight(count: number): number {
  return Math.min(count, WORKING_ROWS) * WORKING_ROW_HEIGHT + (count > WORKING_ROWS ? MORE_HEIGHT : 0);
}

export interface HomeRoom {
  /** Threads and bots at work. */
  count: number;
  /** Threads waiting on the user, each a card. */
  asks: number;
  /** Cards drawn when the Inbox was measured. */
  shown: number;
  /** One card and the gap under it, as drawn (`CARD_PITCH` when the layout gives none). */
  pitch: number;
  /** The Inbox's height without the working rows: the asks as shown, the lane lines, a contact's request, its padding. */
  drawn: number;
  /** The column under the composer that holds the Inbox. */
  column: number;
  /** What the column draws over the Inbox (a folder button, a note). */
  top: number;
  /**
   * The free room above the home's sentence that the block can still rise
   * into. Counting only the column under the composer left the rows folded
   * while 90 px stayed empty over the sentence (round 13, 1440x900).
   */
  spare: number;
  /** The user's own fold of the work, which always wins; null until they used the chevron. */
  fold: 'open' | 'closed' | null;
  /** Cards to keep as they are (a fold the user just changed moves nothing above the chevron). */
  cards?: number;
}

export interface HomeFit {
  /** Needs you cards before `See all`. */
  cards: number;
  /** Whether the working rows show. */
  open: boolean;
  /** The height the column must take for what it draws, or null when nothing grows past the measured asks or it cannot fit. */
  height: number | null;
}

/**
 * Needs you first: as many cards as fit (three at least, six at most), then
 * the work opens when its capped rows fit in what is left. A lane of thirteen
 * draws five rows and its More line, so that is the height tested, not
 * thirteen rows (round 14, the dense home folded it over 300 empty px).
 */
export function homeFit(room: HomeRoom): HomeFit {
  const base = Math.min(room.asks, NEEDS_CARDS);
  const most = Math.min(room.asks, NEEDS_CARDS_MAX);
  const pitch = room.pitch > 0 ? room.pitch : CARD_PITCH;
  const shown = Math.max(base, Math.min(room.shown, room.asks));
  // A column with no height is one the layout hides (a phone's home): nothing grows in it.
  if (room.column <= 0) return { cards: room.cards ?? base, open: room.fold === 'open', height: null };
  const top = Math.max(0, room.top);
  const space = room.column + Math.max(0, room.spare);
  // The Inbox as it would be with only its first three cards.
  const floor = top + room.drawn - (shown - base) * pitch;
  const work = room.count > 0 ? workingHeight(room.count) : 0;
  let cards = room.cards ?? base;
  if (room.cards === undefined) {
    const free = space - floor - (room.fold === 'open' ? work : 0);
    cards = Math.min(most, base + Math.max(0, Math.floor(free / pitch)));
  }
  const asked = floor + (cards - base) * pitch;
  const open = room.fold === null ? room.count > 0 && asked + work <= space : room.fold === 'open' && room.count > 0;
  const need = asked + (open ? work : 0);
  const grows = open || cards > base;
  return { cards, open, height: grows && need <= space ? need : null };
}
