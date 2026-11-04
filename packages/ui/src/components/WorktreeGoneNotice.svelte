<script lang="ts">
  import { FolderMinus } from '@lucide/svelte';
  import type { ThreadWorktreeRemoval } from '@boite/contracts';
  import { exactTime, relativeTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import NoticeBanner from './NoticeBanner.svelte';

  /*
   * Above the composer, or the done notice, of a thread whose worktree Boite
   * removed once its work was settled. The thread still names the folder; the
   * core refuses a turn there. This says so before anyone types, and what
   * became of the branch.
   */
  let { removal, archived }: { removal: ThreadWorktreeRemoval; archived: boolean } = $props();
  const t = $derived(strings.sidebar.worktreeGone);
  const when = $derived(relativeTime(removal.removedAt));
  const why = $derived(removal.reason === 'pr-merged' && removal.pullRequest
    ? fill(t.merged, { when, number: String(removal.pullRequest.number) })
    : fill(t.clean, { when }));
  const branch = $derived(removal.branch === null ? '' : fill(removal.branchDeleted ? t.branchDeleted : t.branchKept, { branch: removal.branch }));
</script>

<NoticeBanner icon={FolderMinus} testid="worktree-gone" title={t.title} titleTip={exactTime(removal.removedAt)} text={[why, branch, archived ? t.archived : t.live].filter(Boolean).join(' ')}>
  {#snippet actions()}
    {#if removal.pullRequest}<a class="pr" href={removal.pullRequest.url} target="_blank" rel="noopener noreferrer">#{removal.pullRequest.number}</a>{/if}
  {/snippet}
</NoticeBanner>

<style>
  .pr { display: inline-flex; align-items: center; height: 26px; padding: 0 8px; border-radius: var(--radius-sm); color: var(--color-accent); font-size: var(--text-xs); font-weight: 500; font-variant-numeric: tabular-nums; text-decoration: none; }
  .pr:hover, .pr:focus-visible { background: var(--color-hover); text-decoration: underline; text-underline-offset: 2px; }
</style>
