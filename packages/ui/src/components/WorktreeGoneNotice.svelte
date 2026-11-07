<script lang="ts">
  import { FolderMinus } from '@lucide/svelte';
  import type { ThreadWorktreeRemoval } from '@boite/contracts';
  import { relativeTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import ThreadNotice from './ThreadNotice.svelte';

  /*
   * Above the composer, or the done notice, of a thread whose worktree Boite
   * removed once its work was settled. The line says what that means for the
   * next message; when and why, and what became of the branch, sit behind the "i".
   */
  let { removal, archived }: { removal: ThreadWorktreeRemoval; archived: boolean } = $props();
  const t = $derived(strings.sidebar.worktreeGone);
  const when = $derived(relativeTime(removal.removedAt));
  const why = $derived(removal.reason === 'pr-merged' && removal.pullRequest
    ? fill(t.merged, { when, number: String(removal.pullRequest.number) })
    : fill(t.clean, { when }));
  const branch = $derived(removal.branch === null ? '' : fill(removal.branchDeleted ? t.branchDeleted : t.branchKept, { branch: removal.branch }));
</script>

<ThreadNotice icon={FolderMinus} tone="quiet" testid="worktree-gone" title={t.title} detail={archived ? t.archived : t.live} info={`${why} ${branch}`.trim()} docked>
  {#if removal.pullRequest}<a class="pr" href={removal.pullRequest.url} target="_blank" rel="noopener noreferrer">#{removal.pullRequest.number}</a>{/if}
</ThreadNotice>
