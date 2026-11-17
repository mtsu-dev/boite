import { SvelteSet } from 'svelte/reactivity';
import type { PromptSuggestion, ThreadId } from '@boite/contracts';
import type { Store } from './store.svelte';

/**
 * The suggestions dismissed on this page, by thread (`store.threadKey`, so
 * machines never collide) and the turn that made them: Esc in one composer
 * hides it in every composer showing that thread, and the next turn's
 * suggestion shows again. Memory only, and bounded.
 */
const dismissed = new SvelteSet<string>();
const DISMISSED_MAX = 200;

const keyOf = (threadKey: string, turnId: string): string => `${threadKey}\u0000${turnId}`;

export function dismissSuggestion(threadKey: string, suggestion: PromptSuggestion): void {
  dismissed.add(keyOf(threadKey, suggestion.turnId));
  if (dismissed.size > DISMISSED_MAX) {
    const oldest = dismissed.values().next().value;
    if (oldest !== undefined) dismissed.delete(oldest);
  }
}

/**
 * The suggestion the core kept for the thread's last turn, unless this page
 * dismissed it. Whether a box can offer it now (empty, idle, no card
 * waiting) is the composer's call.
 */
export function suggestionOf(threadKey: string, suggestion: PromptSuggestion | null | undefined): PromptSuggestion | null {
  if (!suggestion || suggestion.text.trim().length === 0) return null;
  return dismissed.has(keyOf(threadKey, suggestion.turnId)) ? null : suggestion;
}

/** A suggestion a box offers now: its text, and the dismissal for this turn. */
export interface OfferedSuggestion {
  text: string;
  dismiss(): void;
}

/**
 * What the composer offers for `thread`, given to it only while its box is
 * empty, idle and not answering anything (Composer): nothing with the
 * setting off, a turn on its way or a question waiting on the thread.
 */
export function offeredSuggestion(store: Store, thread: { id: ThreadId; suggestion?: PromptSuggestion | null } | null): OfferedSuggestion | null {
  if (!thread || store.settings?.promptSuggestions === false || store.busy) return null;
  if (store.pendingQuestions.some((question) => question.threadId === thread.id)) return null;
  const threadKey = store.threadKey(thread.id);
  const shown = suggestionOf(threadKey, thread.suggestion);
  return shown ? { text: shown.text, dismiss: () => dismissSuggestion(threadKey, shown) } : null;
}
