import type { ThreadSummary } from '@boite/contracts';
import { agentDirectory } from './agent-directory.svelte';
import type { FeedSource } from './activity-feed';
import { strings } from './strings';
import type { Store } from './store.svelte';

/**
 * The one inbox. On a desktop, Activity is the rail's second place: the
 * thread list's column shows the feed while `open`. `contacts` is what waits
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

/** Where a thread outside any project lives in Activity: its bot by name, unless the title already says it. */
export function feedPlace(entry: FeedSource<{ store: Store }>): string | null {
  const bot = agentDirectory(entry.machine.store).ownerOf(entry.thread);
  return bot ? (bot.name === entry.thread.title ? strings.agents.heading : bot.name) : null;
}

/** What Activity reads: every live thread but team chats and council salons, which have no turn of their own to answer. */
export function feedThread(thread: ThreadSummary): boolean {
  return !thread.archived && !thread.incognito && !thread.teamId && !thread.councilId;
}
