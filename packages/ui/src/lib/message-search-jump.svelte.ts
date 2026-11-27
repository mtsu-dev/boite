import { messageSearchTerms, type Message } from '@boite/contracts';
import { tick, untrack } from 'svelte';
import { clearMessageSearch, messageSearchPosition, paintMessageSearch } from './find';
import type { Store } from './store.svelte';

/** Wait for the surrounding page and its virtual row before revealing a palette result. */
export function useMessageSearchJump(
  current: () => { store: Store; threadId: string; messages: Message[]; ready: boolean },
  jump: (id: string, part?: number, offset?: number) => boolean,
  targetRow: () => string | null,
  nodeOf: (row: string) => HTMLElement | undefined,
): void {
  $effect(() => {
    const { store, threadId, messages, ready } = current();
    const target = store.messageSearchJump;
    if (!ready || target?.threadId !== threadId) return;
    const message = messages.find(message => message.id === target.messageId);
    if (!message) return;
    const terms = messageSearchTerms(target.query);
    const hit = messageSearchPosition(message, terms);
    // Keep waiting for a row if the timeline has not finished shaping the page.
    if (!jump(message.id, hit?.part, hit?.offset)) return;
    untrack(() => {
      store.messageSearchJump = null;
      const row = targetRow();
      if (!row) return;
      const paint = (retry: boolean): void => {
        if (targetRow() !== row) return;
        const node = nodeOf(row);
        if (node?.isConnected) paintMessageSearch(node, terms);
        else if (retry && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => paint(false));
      };
      void tick().then(() => paint(true));
    });
  });
  $effect(() => clearMessageSearch);
}
