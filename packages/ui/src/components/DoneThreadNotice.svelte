<script lang="ts">
  import { Archive, ArchiveRestore } from '@lucide/svelte';
  import type { ThreadId, ThreadWorktreeRemoval } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { ThreadRestore } from '../lib/thread-restore.svelte';
  import { strings } from '../lib/strings';
  import { patchFields } from '../lib/thread-rows';
  import InfoTip from './InfoTip.svelte';
  import { removalInfo } from './WorktreeGoneNotice.svelte';

  /** `removal`: Boite also removed its worktree, said in the same sentence, the details behind the "i". */
  let { store, threadId, removal = null }: { store: Store; threadId: ThreadId; removal?: ThreadWorktreeRemoval | null } = $props();
  const lock = new ThreadRestore();

  let words = $derived(removal ? strings.sidebar.worktreeGone.done : strings.sidebar.doneNotice);

  async function reopen(): Promise<void> {
    const owner = store;
    const id = threadId;
    const summary = await lock.restore(owner, id);
    if (summary && owner.openThread?.id === id) patchFields(owner.openThread, summary);
  }
</script>

<!-- In the composer's place: one compact capsule, what the thread is and the one way to go on with it. -->
<div class="done-slot">
  <div class="done-notice" data-testid="done-thread-notice" role="status">
    <span class="mark" aria-hidden="true"><Archive size={15} strokeWidth={1.75} /></span>
    <span class="words ui-label">{words}</span>
    {#if removal}<InfoTip topic={words} text={removalInfo(removal)} testid="done-thread-notice-info" />{/if}
    <button type="button" class="small primary" data-testid="done-thread-reopen" disabled={lock.busy || store.connection !== 'ready'} onclick={() => void reopen()}><ArchiveRestore size={14} /><span class="ui-label">{strings.sidebar.reopenThread}</span></button>
  </div>
</div>

<style>
  /* The composer's column and the gap it keeps under it; the capsule is as wide as its words, centred. */
  .done-slot { display: flex; justify-content: center; width: min(calc(100% - 40px), var(--content)); margin: 0 auto; padding: 4px 0 16px; }
  .done-notice {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    max-width: 100%;
    min-height: 48px;
    padding: 6px 8px 6px 14px;
    border: 1px solid var(--color-composer-edge);
    border-radius: var(--radius-composer);
    background: var(--color-composer-surface);
    box-shadow: var(--shadow-composer);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    animation: rise var(--motion-duration) var(--motion-curve);
  }
  .mark { display: inline-flex; flex: none; color: var(--color-muted-foreground); }
  .words { min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
  .done-notice :global(.info-tip) { flex: none; }
  button { flex: none; gap: 6px; margin-left: 6px; }
  @media (max-width: 720px) {
    .done-slot { width: calc(100% - 20px); padding-bottom: 10px; }
    /* A phone: the capsule takes the column, the action at its end, a full touch target. */
    .done-notice { width: 100%; }
    button { min-height: 40px; margin-left: auto; }
  }
</style>
