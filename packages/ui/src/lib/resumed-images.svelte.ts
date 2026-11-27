import { resolveModelSelection, type Thread } from '@boite/contracts';
import { untrack } from 'svelte';
import { chipChoice } from './composer-choice';
import type { Choice, Store } from './store.svelte';

/**
 * pi's own model on an open thread is the one its session resumes on, or for a
 * new session the one the folder's pi settings may choose, which only the core
 * reads (`threads.capabilities`, `drafts.images` for a draft or a pick). So is a
 * named model the catalog lists text-only, which the folder's own extensions may
 * give images. The key changes when that can:
 * another session, folder, selection or turn, a draft's worktree switch or the worktree its preparation reserved, a new catalog for the account (the core reads
 * the session's model in it, and a name change can put another pi pair behind an id), a reconnection.
 */
function resumedImagesKey(store: Store, thread: Thread | null, choice: Choice | null): string | null {
  if (!choice || store.providerOf(choice.providerId)?.protocol !== 'pi') return null;
  const catalog = (providerId: string, accountId: string) => store.modelsOf(providerId, accountId).map(model => `${model.id}\t${model.name}${model.images === false ? '-' : '+'}${model.virtual ? 'v' : ''}`).join(',');
  const own = (model: string | null) => model === null || model === 'default';
  // A named model the catalog lets read images needs no answer.
  const asks = (model: string | null) => own(model) || resolveModelSelection(store.modelsOf(choice.providerId, choice.accountId), model)?.model.images === false;
  if (!thread) {
    const projectId = store.draft?.projectId;
    if (!projectId || !asks(choice.model)) return null;
    // A new worktree lacks the project's untracked files: the core reads it once this draft's preparation made it.
    const worktree = store.draft?.worktree ? `worktree:${store.preparedWorktree ?? ''}` : '';
    return ['draft', projectId, choice.providerId, choice.accountId, choice.model ?? '', store.connection, catalog(choice.providerId, choice.accountId), worktree].join('\n');
  }
  if (choice.providerId !== thread.providerId || choice.accountId !== thread.accountId) return null;
  if (own(choice.model) ? !own(thread.model) : choice.model !== chipChoice(store, thread)?.model) {
    // A model picked for the next prompt is not the one the session resumes on: it starts in the thread's folder.
    if (own(choice.model) || !thread.projectId || !asks(choice.model)) return null;
    return ['pick', thread.projectId, choice.providerId, choice.accountId, choice.model, store.connection, catalog(choice.providerId, choice.accountId), thread.id, thread.cwd].join('\n');
  }
  if (!asks(thread.model)) return null;
  // A finished turn may have left the session on another model: a queued prompt keeps its own.
  return ['thread', thread.id, thread.sessionId ?? '', thread.cwd, thread.selectionVersion ?? 0, thread.status, store.connection, catalog(thread.providerId, thread.accountId)].join('\n');
}

function askCore(store: Store, key: string): Promise<boolean | null> {
  const [kind, id, providerId, accountId, model, , , last] = key.split('\n');
  if (kind === 'thread') return store.threadCapabilities(id!).then(value => value ? value.images.supported : null);
  const target = kind === 'pick' ? { threadId: last! } : last ? { worktree: true } : {};
  return store.draftImages({ projectId: id!, providerId: providerId!, accountId: accountId!, model: model || null, ...target }).then(value => value ? value.supported : null);
}

/**
 * Whether pi's own model on the open thread or draft reads images: what the core
 * answered for the current key, null while that answer is on its way, undefined
 * when no answer applies (another protocol or model, offline, or the core could not tell).
 */
export class ResumedImages {
  #key = $derived.by(() => resumedImagesKey(this.store(), this.thread(), this.choice()));
  #read = $state<{ key: string; images: boolean | undefined } | null>(null);

  constructor(private readonly store: () => Store, private readonly thread: () => Thread | null, private readonly choice: () => Choice | null) {
    $effect(() => {
      const key = this.#key;
      if (key === null || this.store().connection !== 'ready') return;
      // A reconnection can bring the same key back: an answer read before it no longer holds.
      untrack(() => { this.#read = null; });
      let current = true;
      const answer = (images: boolean | null) => { if (current) this.#read = { key, images: images ?? undefined }; };
      askCore(this.store(), key).then(answer, () => answer(null));
      return () => { current = false; };
    });
  }

  get images(): boolean | null | undefined {
    const key = this.#key;
    if (key === null) return undefined;
    if (this.#read !== null && this.#read.key === key) return this.#read.images;
    return this.store().connection === 'ready' ? null : undefined;
  }
}
