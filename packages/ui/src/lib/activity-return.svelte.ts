import type { ThreadId } from '@boite/contracts';
import { tick } from 'svelte';
import { inbox } from './inbox.svelte';
import { needsYou, rowAsks } from './status-order';
import type { Store } from './store.svelte';
import { threadState } from './thread-state';
import { workspace } from './workspace.svelte';

/**
 * The way back to Activity after acting from it, on a desktop and a phone. An action on a row
 * (Allow, Answer, Review) opens its thread; once that thread no longer needs
 * the user, Activity comes back with its scroll and the keyboard on the row
 * that now stands where the settled one stood. Opening anything else first,
 * another machine's thread included, drops the way back.
 */
type Away = { store: Store; threadId: ThreadId; scroll: number; index: number; arrived: boolean; phone: boolean };

class ActivityReturn {
  away = $state.raw<Away | null>(null);
  /** Where Activity stood, read once by the page as it opens again. */
  back: { scroll: number; index: number } | null = null;
}

export const activityReturn = new ActivityReturn();

/** Activity's page on a desktop, the phone's list showing Activity on a phone. */
const PAGE = '[data-testid=activity-list]';
const PHONE_PAGE = '[data-testid=mobile-list]';

/** Called by a row's action before it opens the thread: remembers the page's scroll and which action was pressed. */
export function leaveForAct(store: Store, threadId: ThreadId, from: Element | null = document.activeElement, phone = false): void {
  const page = document.querySelector<HTMLElement>(phone ? PHONE_PAGE : PAGE);
  const index = from && page ? [...page.querySelectorAll('[data-testid=thread-verb]')].indexOf(from) : -1;
  activityReturn.away = { store, threadId, scroll: page?.scrollTop ?? 0, index: Math.max(0, index), arrived: false, phone };
}

/** The phone's own screens: Activity is a screen of its list there, not the desktop inbox. */
export interface PhoneScreens {
  activity: () => boolean;
  chat: () => boolean;
  reopen: () => void;
}

/**
 * Watches the thread an action opened, from a component that lives as long as
 * its frame: the desktop's (AppRail.svelte), or the phone's list
 * (MobileNavigation.svelte) with its screens. Each follows only the actions
 * pressed in it, since a browser mounts both.
 */
export function followActivityReturn(phone?: PhoneScreens): void {
  $effect(() => {
    const away = activityReturn.away;
    if (!away || away.phone !== (phone !== undefined)) return;
    const { store, threadId } = away;
    const inActivity = phone ? phone.activity() : inbox.open;
    // Another machine in front: its open thread is not this one, even with the same id.
    const there = !inActivity && workspace.active === store && (phone?.chat() ?? true) && store.page === 'chat' && store.openThread?.id === threadId;
    if (!there) {
      // Arrived, then left for something else, or back in Activity by hand: nothing to return to.
      if (away.arrived || inActivity || workspace.active !== store) activityReturn.away = null;
      return;
    }
    away.arrived = true;
    const thread = store.threads.find(entry => entry.id === threadId);
    if (thread && needsYou(threadState(thread, rowAsks(store, threadId)))) return;
    activityReturn.away = null;
    activityReturn.back = { scroll: away.scroll, index: away.index };
    if (phone) { phone.reopen(); return; }
    inbox.open = true;
    store.startDraft(undefined, { refresh: false });
  });
}

/** The page, as it opens: the scroll it had and the keyboard on the action now at the pressed one's place. */
export async function restoreActivity(page: HTMLElement): Promise<void> {
  const back = activityReturn.back;
  activityReturn.back = null;
  if (!back) return;
  await tick();
  page.scrollTop = back.scroll;
  const actions = page.querySelectorAll<HTMLElement>('[data-testid=thread-verb]');
  const target = actions[Math.min(back.index, actions.length - 1)] ?? page;
  target.focus({ preventScroll: true });
}
