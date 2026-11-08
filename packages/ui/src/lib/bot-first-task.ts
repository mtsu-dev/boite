import type { AgentsView } from './agents.svelte';
import type { Store } from './store.svelte';

/**
 * A bot with nothing yet: no thread on its desk and a conversation that holds no message, loaded and with no prompt
 * on its way. Its page then shows one centred first-task prompt over the conversation, instead of an empty desk
 * column beside an empty chat.
 */
export function awaitsFirstTask(store: Store, view: AgentsView, agentId: string): boolean {
  const thread = store.openThread;
  if (!thread?.agentSessionId || thread.messages.length > 0 || thread.status === 'running') return false;
  if (store.loadingThreadId === thread.id || store.staged[thread.id]) return false;
  return !view.snapshot?.watches.some(watch => watch.agentId === agentId);
}
