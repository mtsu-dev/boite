import type { ThreadSummary } from '@boite/contracts';
import { agentDirectory } from './agent-directory.svelte';
import type { FeedSource } from './activity-feed';
export { feedThread } from './activity-feed';
import type { Store } from './store.svelte';

/**
 * The one inbox. On a desktop, Activity is the rail's second place: the main
 * card shows the feed while `open` (App.svelte), the list keeps its threads. `contacts` is what waits
 * from contacts, counted by the toast that already watches them
 * (ContactRequestNotice.svelte), so the rail and the phone's tab carry it
 * without a second watch.
 */
class Inbox {
  open = $state(false);
  contacts = $state(0);
}

export const inbox = new Inbox();

const DONE_KEY = 'boite.done.v1';

/**
 * Done is a filter, not a folder: off, the lists keep only what is live; on,
 * each project card and Recent list their done threads after the others.
 */
class DoneFilter {
  shown = $state(false);

  constructor() {
    try { this.shown = localStorage.getItem(DONE_KEY) === '1'; }
    catch { /* Storage may be unavailable: the filter starts off. */ }
  }

  set(shown: boolean): void {
    this.shown = shown;
    try { localStorage.setItem(DONE_KEY, shown ? '1' : '0'); }
    catch { /* Keep the choice for this session. */ }
  }
}

export const doneFilter = new DoneFilter();

/** Where a thread outside any project lives in Activity: the bot it works for, by name. */
export function feedPlace(entry: FeedSource<{ store: Store }>): string | null {
  return agentDirectory(entry.machine.store).ownerOf(entry.thread)?.name ?? null;
}
