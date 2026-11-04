<script lang="ts">
  import { Hourglass } from '@lucide/svelte';
  import { clockTime, elapsed } from '../lib/format';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import NoticeBanner from './NoticeBanner.svelte';

  /**
   * What the core will try again by itself on the open thread: the next try
   * of a turn the model refused at capacity, the resume of a thread a usage
   * limit stopped, or of a turn that stopped before its answer, with its
   * countdown and a way to give it up. Stop does the same from the composer.
   */
  let { store }: { store: Store } = $props();
  let retry = $derived(store.openThread?.retry ?? null);
  let now = $state(Date.now());
  let pending = $state(false);

  $effect(() => {
    if (!retry) return;
    now = Date.now();
    // A second is the countdown's finest step; a long wait for a reset needs no more.
    const timer = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(timer);
  });

  let left = $derived(retry ? elapsed(Math.max(0, retry.at - now)) : '');
  let body = $derived(!retry ? '' : retry.kind === 'capacity'
    ? fill(strings.thread.retryCapacityBody, { time: left, attempt: String(retry.attempt), attempts: String(retry.attempts) })
    : retry.kind === 'auto-continue'
      ? fill(strings.thread.retryContinueBody, { time: left, attempt: String(retry.attempt), attempts: String(retry.attempts) })
      : fill(strings.thread.retryLimitBody, { time: clockTime(retry.at, now), in: left }));
  let title = $derived(!retry ? '' : retry.kind === 'capacity' ? strings.thread.retryCapacityTitle : retry.kind === 'auto-continue' ? strings.thread.retryContinueTitle : strings.thread.retryLimitTitle);

  async function cancel() {
    const threadId = store.openThread?.id;
    if (!threadId || pending) return;
    pending = true;
    try { await store.cancelRetry(threadId); }
    finally { pending = false; }
  }
</script>

{#if retry}
  <NoticeBanner icon={Hourglass} tone={retry.kind === 'usage-limit' ? 'warning' : 'neutral'} testid="thread-retry" kind={retry.kind} {title} text={body} timer>
    {#snippet actions()}
      <button class="small ghost" data-testid="thread-retry-cancel" disabled={pending || store.connection !== 'ready'} onclick={cancel}>
        <span class="ui-label">{retry.kind === 'capacity' ? strings.thread.retryCapacityCancel : strings.thread.retryLimitCancel}</span>
      </button>
    {/snippet}
  </NoticeBanner>
{/if}
