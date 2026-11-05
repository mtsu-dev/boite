import { untrack } from 'svelte';

/**
 * How many working rings are drawn at once. Past `RING_SPIN_LIMIT` a list of
 * turning arcs reads as noise and costs a compositor layer each, so every
 * working ring holds still until the count drops back. The count is the whole
 * window's: the lists it guards (sidebar, phone list, Inbox, palette) rarely
 * show together, and one shared count needs no list to declare itself.
 */
export const RING_SPIN_LIMIT = 12;

/**
 * The count is plain: rings register from their effects, and a reactive count
 * written by each of sixty mounting rings would rerun every ring sixty times.
 * Only crossing the limit changes the state the rings read.
 */
let spinning = 0;
const still = $state({ on: false });

// Untracked: the effect that registers must not rerun on the state it changes.
function settle(): void {
  const on = spinning > RING_SPIN_LIMIT;
  untrack(() => { if (still.on !== on) still.on = on; });
}

/** Registers one working ring for as long as the caller's effect lives. */
export function holdSpin(): () => void {
  spinning += 1;
  settle();
  return () => { spinning -= 1; settle(); };
}

export function ringsStill(): boolean {
  return still.on;
}
