<script lang="ts">
  import PrivateText from './PrivateText.svelte';
  import { PauseCircle } from '@lucide/svelte';
  import Notice from './Notice.svelte';
  import ResumeTurnControls from './ResumeTurnControls.svelte';
  import { clockTime, providerName } from '../lib/format';
  import { accountName } from '../lib/account-name';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';

  let { store }: { store: Store } = $props();
  let pending = $state(false);
  let held = $derived(store.scheduler?.queued.find(entry => entry.threadId === store.openThread?.id && entry.queueHold));
  let interrupted = $derived(store.openThread?.retry ? null : store.openThread?.recovery ?? null);
  let execution = $derived(store.openThread?.turns.find(turn => turn.id === held?.turnId)?.execution);
  let account = $derived(execution ? store.accounts.find(entry => entry.id === execution.accountId) : undefined);
  let target = $derived(execution ? fill(strings.thread.recoveryTarget, {
    model: execution.model ?? providerName(store, execution.providerId),
    account: account ? accountName(account) : execution.accountId,
  }) : null);

  async function recover(action: 'resume' | 'discard') {
    if (!held || pending) return;
    const { threadId, turnId } = held;
    pending = true;
    try { await store.recoverTurn(threadId, turnId, action); }
    finally { pending = false; }
  }
</script>

{#snippet choices()}
  <button type="button" class="small primary" disabled={pending || store.connection !== 'ready'} onclick={() => recover('resume')}><span class="ui-label">{strings.thread.recoveryResume}</span></button>
  <button type="button" class="small" disabled={pending || store.connection !== 'ready'} onclick={() => recover('discard')}><span class="ui-label">{strings.thread.recoveryDiscard}</span></button>
{/snippet}

{#if held}
  <!-- The one notice form: what is held, where it would go, Resume or Discard. -->
  <Notice icon={PauseCircle} testid="thread-recovery" title={strings.thread.recoveryTitle} detail={strings.thread.recoveryBody} docked actions={choices}>
    {#if target}<span class="target"><PrivateText text={target} /></span>{/if}
  </Notice>
{:else if interrupted}
  {@const quota = interrupted.kind === 'usage-limit'}
  {@const reset = interrupted.resetsAt}
  {#snippet resume()}
    <ResumeTurnControls {store} recovery={interrupted!} />
  {/snippet}
  <Notice icon={PauseCircle} testid="thread-interrupted" title={quota ? strings.thread.retryLimitTitle : strings.thread.retryContinueTitle}
    detail={quota ? reset == null ? strings.thread.resumeUnknownReset : fill(strings.thread.resumeKnownReset, { time: clockTime(reset, Date.now()) })
      : interrupted.detail ? undefined : strings.thread.resumeInterruptedBody}
    docked actions={resume}>
    {#if interrupted.detail}<span class="target"><PrivateText text={interrupted.detail} /></span>{/if}
  </Notice>
{/if}

<style>
  .target { display: block; margin-top: 2px; overflow-wrap: anywhere; }
</style>
