<script lang="ts">
  import { Archive, ArchiveRestore } from '@lucide/svelte';
  import type { ThreadId } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { ThreadRestore } from '../lib/thread-restore.svelte';
  import { strings } from '../lib/strings';
  import { patchFields } from '../lib/thread-rows';
  import ThreadNotice from './ThreadNotice.svelte';

  let { store, threadId }: { store: Store; threadId: ThreadId } = $props();
  const lock = new ThreadRestore();

  async function reopen(): Promise<void> {
    const owner = store;
    const id = threadId;
    const summary = await lock.restore(owner, id);
    if (summary && owner.openThread?.id === id) patchFields(owner.openThread, summary);
  }
</script>

<div class="done-notice">
  <ThreadNotice icon={Archive} tone="quiet" testid="done-thread-notice" detail={strings.sidebar.doneNotice} docked>
    {#snippet actions()}
      <button type="button" class="small" data-testid="done-thread-reopen" disabled={lock.busy || store.connection !== 'ready'} onclick={() => void reopen()}><ArchiveRestore size={14} /><span class="ui-label">{strings.sidebar.reopenThread}</span></button>
    {/snippet}
  </ThreadNotice>
</div>

<style>
  /* In the composer's place: the same gap under it as the composer keeps. */
  .done-notice { display: flex; flex-direction: column; padding: 4px 0 8px; }
</style>
