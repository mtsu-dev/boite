import type { Snippet } from 'svelte';

/**
 * A page's own head, drawn in the main column's top bar on a desktop. The
 * Agents page puts the open bot's name and buttons there, so its card starts
 * with the conversation. The page that set it clears it when it leaves.
 */
class TitleSlot {
  current = $state.raw<Snippet | null>(null);
}

export const titleSlot = new TitleSlot();
