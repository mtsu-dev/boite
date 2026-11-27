import { resolveModelSelection, type RpcParams, type Thread, type ThreadId } from '@boite/contracts';
import { untrack } from 'svelte';
import { chipChoice } from './composer-choice';
import type { Choice, Store } from './store.svelte';

/** What the core is asked, and what else changes its answer: the cache key is both, serialized. */
type ImagesRequest = { ask: { thread: ThreadId } | { draft: RpcParams<'drafts.images'> }; also: unknown[] };

/**
 * pi's own model on an open thread is the one its session resumes on, or for a
 * new session the one the folder's pi settings may choose, which only the core
 * reads (`threads.capabilities`, `drafts.images` for a draft or a pick). So is a
 * named model the catalog lists text-only, which the folder's own extensions may
 * give images. The key changes when that can: another session, folder, selection
 * or turn, a draft's worktree or incognito switch or the new folder its preparation
 * made, a new catalog for the account (the core reads the session's model in it,
 * and a name change can put another pi pair behind an id), a reconnection.
 */
function resumedImagesRequest(store: Store, thread: Thread | null, choice: Choice | null): ImagesRequest | null {
  if (!choice || store.providerOf(choice.providerId)?.protocol !== 'pi') return null;
  const catalog = (providerId: string, accountId: string) => store.modelsOf(providerId, accountId).map(model => [model.id, model.name, model.images !== false, model.virtual === true]);
  const own = (model: string | null) => model === null || model === 'default';
  // A named model the catalog lets read images needs no answer.
  const asks = (model: string | null) => own(model) || resolveModelSelection(store.modelsOf(choice.providerId, choice.accountId), model)?.model.images === false;
  const draft = (projectId: string, model: string | null, extra: Partial<RpcParams<'drafts.images'>>) =>
    ({ projectId, providerId: choice.providerId, accountId: choice.accountId, model, ...extra });
  if (!thread) {
    const projectId = store.draft?.projectId;
    if (!projectId || !asks(choice.model)) return null;
    const worktree = store.draft?.worktree === true;
    const incognito = store.draft?.incognito === true && store.draftInDrafts;
    // A new worktree or drafts folder lacks the project's untracked files: the core reads it once this draft's preparation made it.
    const fresh = worktree || store.draftInDrafts;
    return { ask: { draft: draft(projectId, choice.model ?? null, { ...(worktree ? { worktree } : {}), ...(incognito ? { incognito } : {}) }) },
      also: [store.connection, catalog(choice.providerId, choice.accountId), fresh ? store.preparedFolder(store.draft) : null] };
  }
  if (choice.providerId !== thread.providerId || choice.accountId !== thread.accountId) return null;
  if (own(choice.model) ? !own(thread.model) : choice.model !== chipChoice(store, thread)?.model) {
    // A model picked for the next prompt is not the one the session resumes on: it starts in the thread's folder.
    if (own(choice.model) || !thread.projectId || !asks(choice.model)) return null;
    return { ask: { draft: draft(thread.projectId, choice.model, { threadId: thread.id }) }, also: [store.connection, catalog(choice.providerId, choice.accountId), thread.cwd] };
  }
  if (!asks(thread.model)) return null;
  // A finished turn may have left the session on another model: a queued prompt keeps its own.
  return { ask: { thread: thread.id }, also: [thread.sessionId ?? null, thread.cwd, thread.selectionVersion ?? 0, thread.status, store.connection, catalog(thread.providerId, thread.accountId)] };
}

function askCore(store: Store, { ask }: ImagesRequest): Promise<boolean | null> {
  if ('thread' in ask) return store.threadCapabilities(ask.thread).then(value => value ? value.images.supported : null);
  return store.draftImages(ask.draft).then(value => value ? value.supported : null);
}

/**
 * Whether pi's own model on the open thread or draft reads images: what the core
 * answered for the current key, null while that answer is on its way, undefined
 * when no answer applies (another protocol or model, offline, or the core could not tell).
 */
export class ResumedImages {
  #request = $derived.by(() => resumedImagesRequest(this.store(), this.thread(), this.choice()));
  #key = $derived(this.#request ? JSON.stringify(this.#request) : null);
  #read = $state<{ key: string; images: boolean | undefined } | null>(null);

  constructor(private readonly store: () => Store, private readonly thread: () => Thread | null, private readonly choice: () => Choice | null) {
    $effect(() => {
      const key = this.#key;
      if (key === null || this.store().connection !== 'ready') return;
      // A reconnection can bring the same key back: an answer read before it no longer holds.
      untrack(() => { this.#read = null; });
      let current = true;
      const answer = (images: boolean | null) => { if (current) this.#read = { key, images: images ?? undefined }; };
      askCore(this.store(), JSON.parse(key) as ImagesRequest).then(answer, () => answer(null));
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
