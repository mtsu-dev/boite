<script lang="ts">
  import { GitMerge, GitPullRequest, GitPullRequestClosed } from '@lucide/svelte';
  import type { ThreadSummary } from '@boite/contracts';
  import { openExternal } from '../lib/links';
  import { pullRequestLabel } from './ThreadHeadline.svelte';

  /** A thread row's place line (ThreadCard.svelte, MobileThreadRow.svelte): the thread's pull request, its number in its state's tone; a click opens it. */
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
  /* One vibrance for the three states: the merged violet is the measure, the open amber and the closed red are
     brought down to it by a share of the row's own ink, so a state is read, never shouted. */
  .pr-link { display: inline-flex; align-items: center; flex-shrink: 0; gap: 4px; color: color-mix(in oklch, var(--color-live) 70%, var(--color-muted-foreground)); font-size: var(--text-xs); pointer-events: auto; text-decoration: underline; text-decoration-color: color-mix(in oklch, currentColor 45%, transparent); text-underline-offset: 3px; }
  .pr-link.merged { color: var(--color-accent); }
  .pr-link.closed { color: color-mix(in oklch, var(--color-danger) 60%, var(--color-muted-foreground)); }
  .pr-link:hover { text-decoration-color: currentColor; }
</style>
