/**
 * Whether the home's "Working now" lane opens by itself (home/Inbox.svelte):
 * when its rows fit whole in the room the home's column really has, they
 * show; when they would make the column scroll, they wait under their line.
 */

/** Rows shown before `See all`. */
export const WORKING_ROWS = 5;
/** A working row's height (`.row`'s min-height), and the `See all` line under five. */
export const WORKING_ROW_HEIGHT = 34;
export const MORE_HEIGHT = 34;

/** How tall the open work is: up to five rows, then the `See all` line. */
export function workingHeight(count: number): number {
  return Math.min(count, WORKING_ROWS) * WORKING_ROW_HEIGHT + (count > WORKING_ROWS ? MORE_HEIGHT : 0);
}

export interface WorkingRoom {
  /** Threads and bots at work. */
  count: number;
  /** The Inbox's height without the working rows: the asks, the lane lines, a contact's request, its padding. */
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
}

/** The height the column must take for the open rows, or null when they do not fit in the room it has. */
export function workingFit(room: WorkingRoom): number | null {
  // A column with no height is one the layout hides (a phone's home): nothing fits in it.
  if (room.count <= 0 || room.column <= 0) return null;
  const top = Math.max(0, room.top);
  const need = top + room.drawn + workingHeight(room.count);
  return need <= room.column + Math.max(0, room.spare) ? need : null;
}

/**
 * Whether the lane opens before the user touched its chevron: its rows fit
 * (`workingFit`) and every one of them shows. A cut list (more than five, the
 * dense home) waits folded under its line even when five rows would fit; the
 * chevron opens it.
 */
export function opensByItself(count: number, height: number | null): boolean {
  return height !== null && count <= WORKING_ROWS;
}
