<script lang="ts">
  import type { ThreadRecovery } from '@boite/contracts';
  import ModelPicker from './ModelPicker.svelte';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';

  let { store, recovery }: { store: Store; recovery: ThreadRecovery } = $props();
  let thread = $derived(store.openThread);
  let pending = $state(false);
  let disabled = $derived(pending || store.connection !== 'ready');

  async function resume(model?: string | null) {
    if (disabled || !thread) return;
    pending = true;
    try {
      await store.resumeTurn({ threadId: thread.id, turnId: recovery.turnId, model, expectedSelectionVersion: thread.selectionVersion ?? 0 });
    } finally { pending = false; }
  }
</script>

<button type="button" class="small primary" {disabled} onclick={() => resume()}>
  <span class="ui-label">{strings.thread.resumeInterrupted}</span>
</button>
{#if thread && recovery.kind === 'usage-limit' && !thread.agentSessionId && store.accountOf(thread.accountId)}
  <ModelPicker {store} choice={thread} single locked {disabled} actionLabel={strings.thread.resumeWithModel}
    onpick={patch => { if (patch.model !== undefined) void resume(patch.model); }} />
{/if}
