import type { Thread } from '@boite/contracts';
import type { Choice, Store } from './store.svelte';

const threadChoice = (thread: Thread): Choice => ({ providerId: thread.providerId, accountId: thread.accountId, permissionMode: thread.permissionMode, model: thread.model, effort: thread.effort, speed: thread.speed ?? null });

/** The chips' choice: the open thread's, or the remembered one on a draft. */
export function chipChoice(store: Store, thread: Thread | null): Choice | null {
  if (thread) return store.composerChoice(threadChoice(thread));
  return store.draft ? store.defaultChoice() : null;
}

/**
 * The choice a queued prompt keeps. While the chips show what the thread
 * resolves to, the thread's own selection: a model left to the agent's
 * default stays unset, as in the running turn, which the prompt can then
 * steer. A pick of the user's own is kept as it is.
 */
export function queuedChoice(store: Store, thread: Thread | null, choice: Choice): Choice {
  if (!thread) return choice;
  const own = threadChoice(thread), shown = store.composerChoice(own);
  const same = (Object.keys(own) as (keyof Choice)[]).every(field => (shown[field] ?? null) === (choice[field] ?? null));
  return same ? own : choice;
}
