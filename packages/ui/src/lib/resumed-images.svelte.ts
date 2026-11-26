import type { Thread } from '@boite/contracts';
import { chipChoice } from './composer-choice';
import type { Choice, Store } from './store.svelte';

/**
 * pi's own model on an open thread is the one its session resumes on, which
 * only the core reads (`threads.capabilities`). The key changes when that can:
 * another session or selection, a new catalog for the account (the core reads
 * the session's model in it), a reconnection.
 */
function resumedImagesKey(store: Store, thread: Thread | null, choice: Choice | null): string | null {
  if (!thread?.sessionId || !choice || store.providerOf(choice.providerId)?.protocol !== 'pi') return null;
  if ((thread.model !== null && thread.model !== 'default') || choice.providerId !== thread.providerId || choice.accountId !== thread.accountId) return null;
  // A model picked for the next prompt is not the one the session resumes on.
  if (choice.model !== null && choice.model !== 'default' && choice.model !== chipChoice(store, thread)?.model) return null;
  const catalog = store.modelsOf(thread.providerId, thread.accountId).map(model => `${model.id}${model.images === false ? '-' : '+'}${model.virtual ? 'v' : ''}`).join(',');
  return [thread.id, thread.sessionId, thread.selectionVersion ?? 0, store.connection, catalog].join('\n');
}

/** Whether the open thread's resumed pi session reads images, once the core answered for the current key. */
export class ResumedImages {
  #key = $derived.by(() => resumedImagesKey(this.store(), this.thread(), this.choice()));
  #read = $state<{ key: string; images: boolean } | null>(null);

  constructor(private readonly store: () => Store, private readonly thread: () => Thread | null, private readonly choice: () => Choice | null) {
    $effect(() => {
      const key = this.#key;
      if (key === null || this.store().connection !== 'ready') return;
      let current = true;
      this.store().threadCapabilities(key.split('\n')[0]!).then(value => { if (current && value) this.#read = { key, images: value.images.supported }; }, () => {});
      return () => { current = false; };
    });
  }

  get images(): boolean | undefined {
    return this.#read !== null && this.#read.key === this.#key ? this.#read.images : undefined;
  }
}
