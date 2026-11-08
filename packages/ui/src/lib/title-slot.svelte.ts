import type { Snippet } from 'svelte';

/**
 * A screen's one title, drawn in the band above the inset card on a desktop:
 * the card under it repeats no heading. The Agents page puts the open bot's
 * name and buttons there, Settings the page's group and its "i". Any screen
 * may set it; the one that set it clears it when it leaves.
 */
class TitleSlot {
  current = $state.raw<Snippet | null>(null);
  /** A page's own buttons, at the band's right end: the card keeps no header row for them alone. */
  actions = $state.raw<Snippet | null>(null);
}

export const titleSlot = new TitleSlot();
