<script lang="ts">
  import { PauseCircle } from '@lucide/svelte';
  import { providerName } from '../lib/format';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import NoticeBanner from './NoticeBanner.svelte';

  let { store }: { store: Store } = $props();
  let pending = $state(false);
  let held = $derived(store.scheduler?.queued.find(entry => entry.threadId === store.openThread?.id && entry.queueHold));
  let execution = $derived(store.openThread?.turns.find(turn => turn.id === held?.turnId)?.execution);
  let target = $derived(execution ? fill(strings.thread.recoveryTarget, {
    model: execution.model ?? providerName(store, execution.providerId),
    account: store.accounts.find(account => account.id === execution.accountId)?.label ?? execution.accountId,
  }) : null);

  async function recover(action: 'resume' | 'discard') {
    if (!held || pending) return;
    const { threadId, turnId } = held;
    pending = true;
    try { await store.recoverTurn(threadId, turnId, action); }
    finally { pending = false; }
  }
</script>

{#snippet targetLine()}<p class="target">{target}</p>{/snippet}

{#if held}
  <NoticeBanner icon={PauseCircle} tone="warning" testid="thread-recovery" title={strings.thread.recoveryTitle} text={strings.thread.recoveryBody} details={target ? targetLine : undefined}>
    {#snippet actions()}
      <button class="small primary" disabled={pending || store.connection !== 'ready'} onclick={() => recover('resume')}><span class="ui-label">{strings.thread.recoveryResume}</span></button>
      <button class="small ghost" disabled={pending || store.connection !== 'ready'} onclick={() => recover('discard')}><span class="ui-label">{strings.thread.recoveryDiscard}</span></button>
    {/snippet}
  </NoticeBanner>
{/if}
