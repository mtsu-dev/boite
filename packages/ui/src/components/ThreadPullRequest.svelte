<script lang="ts">
  import type { ThreadSummary } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { trackThreadPullRequest } from '../lib/thread-pull-request.svelte';
  import { fill, strings } from '../lib/strings';
  import PullRequestBadge from './PullRequestBadge.svelte';
  /**
   * The thread's pull request: its badge, a link, in the title bar's pill; as
   * `text`, its number alone after a phone title's subtitle, which sits inside
   * the title's menu button and may not hold a link. `separated` puts the
   * subtitle's dot before it.
   */
  let { owner, thread, text = false, separated = false }: { owner: Store; thread: ThreadSummary; text?: boolean; separated?: boolean } = $props();
  const pr = trackThreadPullRequest(() => ({ owner, thread }));
  const label = $derived(pr.value ? fill(pr.value.state === 'MERGED' ? strings.sidebar.prMerged : pr.value.state === 'CLOSED' ? strings.sidebar.prClosed : strings.sidebar.prOpen, { number: String(pr.value.number) }) : '');
</script>

{#if pr.value}
  {#if text}<span class="pr-text {pr.value.state.toLowerCase()}" data-testid="thread-pr-text" data-state={pr.value.state} aria-label={label}>{separated ? ' · ' : ''}#{pr.value.number}</span>
  {:else}<PullRequestBadge pullRequest={pr.value} />{/if}
{/if}

<style>
  .pr-text { color: inherit; font-variant-numeric: tabular-nums; }
</style>
