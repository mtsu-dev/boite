<script lang="ts">
  import { GitMerge, GitPullRequest, GitPullRequestClosed } from '@lucide/svelte';
  import type { ThreadSummary } from '@boite/contracts';
  import { openExternal } from '../lib/links';
  import { pullRequestLabel } from './ThreadHeadline.svelte';

  /** Recent's place line: the thread's pull request, its number in its state's tone; a click opens it. */
  let { pullRequest }: { pullRequest: NonNullable<ThreadSummary['pullRequest']> } = $props();
  const label = $derived(pullRequestLabel(pullRequest));
  function open(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void openExternal(pullRequest.url);
  }
</script>

<a class="pr-link {pullRequest.state.toLowerCase()}" data-testid="thread-pr" data-state={pullRequest.state} href={pullRequest.url} title={`${label}\n${pullRequest.url}`} aria-label={label} onclick={open}>
  {#if pullRequest.state === 'MERGED'}<GitMerge size={12} />{:else if pullRequest.state === 'CLOSED'}<GitPullRequestClosed size={12} />{:else}<GitPullRequest size={12} />{/if}<span class="ui-label">#{pullRequest.number}</span>
</a>

<style>
  .pr-link { display: inline-flex; align-items: center; flex-shrink: 0; gap: 4px; color: var(--color-live); font-size: var(--text-xs); pointer-events: auto; text-decoration: underline; text-underline-offset: 3px; }
  .pr-link.merged { color: var(--color-accent); }
  .pr-link.closed { color: var(--color-danger); }
</style>
