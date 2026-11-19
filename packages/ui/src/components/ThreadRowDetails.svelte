<script lang="ts">
  import { GitBranch } from '@lucide/svelte';
  import type { ThreadSummary } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import PullRequestBadge from './PullRequestBadge.svelte';

  let { offline, branch, pullRequest }: {
    offline: boolean; branch?: string | null; pullRequest?: ThreadSummary['pullRequest'];
  } = $props();
</script>

{#if offline}<span class="offline-chip" data-testid="thread-offline">{strings.connection.offline}</span>{/if}
{#if pullRequest}<PullRequestBadge {pullRequest} />{/if}
{#if branch}<span class="branch" data-testid="thread-branch" title={branch}><GitBranch size={12} /><span class="ui-label">{branch}</span></span>{/if}

<style>
  .offline-chip { flex: none; padding: 0 6px; border: 1px solid var(--color-edge); border-radius: var(--radius-sm); }
  .branch { display: flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; overflow: hidden; }
  .branch :global(svg) { flex: none; }
  .branch .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
