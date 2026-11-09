<script lang="ts" module>
  import type { ThreadWorktreeRemoval } from '@boite/contracts';
  import { relativeTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';

  /** When and why Boite removed the worktree, and what became of its branch: the text behind the "i". */
  export function removalInfo(removal: ThreadWorktreeRemoval): string {
    const t = strings.sidebar.worktreeGone;
    const when = relativeTime(removal.removedAt);
    const why = removal.reason === 'pr-merged' && removal.pullRequest
      ? fill(t.merged, { when, number: String(removal.pullRequest.number) })
      : fill(t.clean, { when });
    const branch = removal.branch === null ? '' : fill(removal.branchDeleted ? t.branchDeleted : t.branchKept, { branch: removal.branch });
    return `${why} ${branch}`.trim();
  }
</script>

<script lang="ts">
  import { FolderMinus, Plus } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import Notice from './Notice.svelte';

  /*
   * In the composer's place of a live thread whose worktree Boite removed once
   * its work was settled: one line and one button that starts the thread that
   * keeps working in the project. When and why, and what became of the
   * branch, sit behind the "i". A done thread says it in its done notice.
   */
  let { store, projectId, removal }: { store: Store; projectId: string | null; removal: ThreadWorktreeRemoval } = $props();
  const t = $derived(strings.sidebar.worktreeGone);
</script>

<Notice icon={FolderMinus} tone="info" testid="worktree-gone" title={t.title} info={removalInfo(removal)} docked replaces>
  {#snippet actions()}
    <button type="button" class="small primary" data-testid="worktree-gone-new" onclick={() => store.startDraft(projectId)}><Plus size={13} strokeWidth={1.75} /><span class="ui-label">{t.startHere}</span></button>
  {/snippet}
</Notice>
