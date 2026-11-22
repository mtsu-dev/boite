import type { Message, Turn } from '@boite/contracts';
import { ViewPlacement, turnViews, viewLines } from './inline-view';
import { filesLast } from './message-order';

/** Place views after the answer and its files, or inline where the answer names them. */
export function inlineTimeline(
  timeline: () => Message[],
  turns: () => readonly Pick<Turn, 'id' | 'status'>[],
  files: () => Parameters<typeof filesLast>[2],
) {
  let shownViews: ReadonlyMap<string, Message[]> | undefined;
  const views = $derived.by(() => (shownViews = turnViews(timeline(), shownViews)));
  const viewPlacement = new ViewPlacement();
  const ordered = $derived(filesLast(timeline(), turns(), files()));
  // Read text only for turns with views; rebuild the timeline when their placements change.
  const answersWithViews = $derived(viewLines(ordered, views));
  const inlineViews = $derived(viewPlacement.inline(answersWithViews, views));
  const placed = $derived(viewPlacement.build(ordered, turns(), views, inlineViews));
  return {
    get views() { return views; },
    get placed() { return placed; },
  };
}
