import type { Thread } from '@boite/contracts';
import { chipChoice } from './composer-choice';
import type { Choice, Store } from './store.svelte';

/**
 * pi's own model on an open thread is the one its session resumes on, or for a
 * new session the one the folder's pi settings may choose, which only the core
 * reads (`threads.capabilities`, `drafts.images` for a draft). The key changes when that can:
 * another session, folder, selection or turn, a new catalog for the account (the core reads
 * the session's model in it), a reconnection.
 */
function resumedImagesKey(store: Store, thread: Thread | null, choice: Choice | null): string | null {
  if (!choice || store.providerOf(choice.providerId)?.protocol !== 'pi') return null;
  const catalog = (providerId: string, accountId: string) => store.modelsOf(providerId, accountId).map(model => `${model.id}${model.images === false ? '-' : '+'}${model.virtual ? 'v' : ''}`).join(',');
  if (!thread) {
    const projectId = store.draft?.projectId;
    if (!projectId || (choice.model !== null && choice.model !== 'default')) return null;
    return ['draft', projectId, choice.providerId, choice.accountId, choice.model ?? '', store.connection, catalog(choice.providerId, choice.accountId)].join('\n');
  }
  if ((thread.model !== null && thread.model !== 'default') || choice.providerId !== thread.providerId || choice.accountId !== thread.accountId) return null;
  // A model picked for the next prompt is not the one the session resumes on.
  if (choice.model !== null && choice.model !== 'default' && choice.model !== chipChoice(store, thread)?.model) return null;
  // A finished turn may have left the session on another model: a queued prompt keeps its own.
  return ['thread', thread.id, thread.sessionId ?? '', thread.cwd, thread.selectionVersion ?? 0, thread.status, store.connection, catalog(thread.providerId, thread.accountId)].join('\n');
}

function askCore(store: Store, key: string): Promise<boolean | null> {
  const [kind, id, providerId, accountId, model] = key.split('\n');
  if (kind === 'thread') return store.threadCapabilities(id!).then(value => value ? value.images.supported : null);
  return store.draftImages({ projectId: id!, providerId: providerId!, accountId: accountId!, model: model || null }).then(value => value ? value.supported : null);
}

/** Whether pi's own model on the open thread or draft reads images, once the core answered for the current key. */
export class ResumedImages {
  #key = $derived.by(() => resumedImagesKey(this.store(), this.thread(), this.choice()));
  #read = $state<{ key: string; images: boolean } | null>(null);

  constructor(private readonly store: () => Store, private readonly thread: () => Thread | null, private readonly choice: () => Choice | null) {
    $effect(() => {
      const key = this.#key;
      if (key === null || this.store().connection !== 'ready') return;
      let current = true;
      askCore(this.store(), key).then(images => { if (current && images !== null) this.#read = { key, images }; }, () => {});
      return () => { current = false; };
    });
  }

  get images(): boolean | undefined {
    return this.#read !== null && this.#read.key === this.#key ? this.#read.images : undefined;
  }
}
