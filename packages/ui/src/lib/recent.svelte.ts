import { threadActive, type ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { hasUnsentDraft } from './composer-queue';
import { archiveThread } from './archive';
import { threadState } from './thread-state';
import { rowAsks } from './status-order';
import { strings } from './strings';

export const RECENT_STORAGE_KEY = 'boite.recent.v1';

/** A screen's attention preference, independent of its selected machine. */
export class RecentPreferences {
  groupWorking = $state(false);
  groupOtherProjects = $state(true);

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? '{}');
      this.groupWorking = saved.groupWorking === true;
      this.groupOtherProjects = saved.groupOtherProjects !== false;
    }
    catch { /* The default also works when storage is unavailable. */ }
  }

  setGroupWorking(enabled: boolean): void {
    this.groupWorking = enabled;
    this.#save();
  }

  setGroupOtherProjects(enabled: boolean): void {
    this.groupOtherProjects = enabled;
    this.#save();
  }

  #save(): void {
    try { localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify({ groupWorking: this.groupWorking, groupOtherProjects: this.groupOtherProjects })); }
    catch { /* Keep the choice for this session. */ }
  }
}

export const recentPreferences = new RecentPreferences();

/** Pins, pending input, failures and questions stay in the user's attention list. */
export function groupWorkingThread(store: Store, thread: ThreadSummary): boolean {
  if (thread.pinned || hasUnsentDraft(store.composerStates[thread.id])) return false;
  return workingThread(store, thread);
}

/** At work, its own turn, its delegated agents', what it left running or a pull request it watches: nothing for the user to do yet. */
export function workingThread(store: Pick<Store, 'subagents'>, thread: ThreadSummary): boolean {
  const state = threadState(thread, rowAsks(store, thread.id));
  return state === 'working' || state === 'queued' || state === 'delegating' || state === 'monitoring' || state === 'background' || state === 'watching';
}

/** Marking done requires an idle thread and accepts unsent drafts. */
export function canMarkDone(store: Store, thread: ThreadSummary): boolean {
  return !thread.archived && store.connection === 'ready' && !threadActive(thread.status)
    && !thread.backgroundWork?.kinds.length && !thread.pendingMove && !store.moveBlocked(thread.id);
}

/** Why Mark done is off for a kept thread, in a few words for its disabled row; null when it can be done. */
export function markDoneBlocker(store: Store, thread: ThreadSummary): string | null {
  if (canMarkDone(store, thread) || thread.archived) return null;
  if (store.connection !== 'ready') return strings.sidebar.doneWhyOffline;
  if (thread.pendingMove) return strings.sidebar.doneWhyMoving;
  return strings.sidebar.doneWhyWorking;
}

export async function markDone(store: Store, thread: ThreadSummary): Promise<boolean> {
  if (!canMarkDone(store, thread)) return false;
  return archiveThread(store, thread.id, { done: true });
}
