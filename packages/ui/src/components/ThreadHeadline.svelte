<script module lang="ts">
  import { fill, strings } from '../lib/strings';
  import type { ThreadSummary as Summary } from '@boite/contracts';

  /** The pull request in words, for the mark and for the row's tooltip. */
  export function pullRequestLabel(pullRequest: NonNullable<Summary['pullRequest']>): string {
    return fill(pullRequest.state === 'MERGED' ? strings.sidebar.prMerged : pullRequest.state === 'CLOSED' ? strings.sidebar.prClosed : strings.sidebar.prOpen, { number: String(pullRequest.number) });
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { rowAsks, stateForm } from '../lib/status-order';
  import { GitMerge, GitPullRequest, GitPullRequestClosed, PencilLine, Pin } from '@lucide/svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { hasUnsentDraft } from '../lib/composer-queue';
  import { threadState } from '../lib/thread-state';
  import { openExternal } from '../lib/links';
  import { ago, exactTime } from '../lib/format';
  import ProjectTile from './ProjectTile.svelte';
  import ThreadState from './ThreadState.svelte';

  /**
   * Every thread row's one line, in the sidebar, Recent, Activity and a phone's
   * lists: the title takes the width, then an unsent draft, the pin, the pull
   * request when there is one, and the state at the end, in one slot, with the
   * time after it. The thread's header names its agent, so the row carries no
   * provider glyph; a flat list (`tile`) shows the project's tile first, since
   * no card names it. `mark` draws the state as the narrow mark
   * (ThreadState.svelte). `ask` (Activity) follows the title on its line when
   * both fit, and runs under it otherwise. `at` is a time of the row's own
   * (Activity's since when, a phone's last message): it follows the mark, and
   * stands alone when there is none.
   */
  let {
    owner,
    thread,
    now,
    open = false,
    tile,
    pullRequest = null,
    mark = false,
    ask,
    at
  }: {
    owner: Store;
    thread: ThreadSummary;
    /** Without it the row draws the state itself, elsewhere. */
    now?: number;
    /** The open thread shows its box: its row marks no draft. */
    open?: boolean;
    /** The project's tile, in a list that mixes projects. */
    tile?: Project;
    /** The thread's pull request, looked up by the row. */
    pullRequest?: ThreadSummary['pullRequest'];
    mark?: boolean;
    ask?: Snippet;
    at?: number;
  } = $props();
  const kind = $derived(threadState(thread, rowAsks(owner, thread.id)));
  let draft = $derived(!open && hasUnsentDraft(owner.composerStates[thread.id]));
  const prLabel = $derived(pullRequest && pullRequestLabel(pullRequest));
  function openPullRequest(event: MouseEvent) {
    if (!pullRequest) return;
    event.stopPropagation();
    event.preventDefault();
    void openExternal(pullRequest.url);
  }
</script>

<span class="headline" class:unread={thread.unread} class:hot={open || kind !== null}>
  {#if tile}<ProjectTile project={tile} store={owner} size={16} />{/if}
  {#if ask}<span class="lead"><span class="title ui-label">{thread.title}</span>{@render ask()}</span>{:else}<span class="title ui-label">{thread.title}</span>{/if}
  {#if draft}<span class="draft" data-testid="thread-draft" title={strings.sidebar.unsentDraft} aria-label={strings.sidebar.unsentDraft}><PencilLine size={12} /></span>{/if}
  {#if thread.pinned}<span class="pin"><Pin size={12} /></span>{/if}
  {#if pullRequest}
    <!-- No link inside the row's button: a click on the mark opens the pull request, the keyboard opens the thread. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <span class="pr {pullRequest.state.toLowerCase()}" data-testid="thread-pr" data-state={pullRequest.state}
      title={thread.branch ? `${prLabel}\n${thread.branch}` : prLabel} aria-label={prLabel} onclick={openPullRequest}>
      {#if pullRequest.state === 'MERGED'}<GitMerge size={12} aria-hidden="true" />{:else if pullRequest.state === 'CLOSED'}<GitPullRequestClosed size={12} aria-hidden="true" />{:else}<GitPullRequest size={12} aria-hidden="true" />{/if}<span class="ui-label">#{pullRequest.number}</span>
    </span>
  {/if}
  {#if now !== undefined && (at === undefined || stateForm(thread.archived ? null : kind) !== null)}<ThreadState {thread} {now} subagents={rowAsks(owner, thread.id)} away={owner.connection !== 'ready'} {mark} />{/if}
  {#if now !== undefined && at !== undefined}<time class="at" title={exactTime(at)}>{ago(at, now)}</time>{/if}
</span>

<style>
  .headline {
    display: flex;
    align-items: center;
    min-height: 20px;
    gap: 8px;
    min-width: 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* In the list, a row at rest reads a step back; one with a state to show reads at full strength. */
    color: var(--color-muted-foreground);
    font-weight: 500;
  }
  /* Activity: what is asked shares the title's line when both fit, and wraps under the title's edge when not. */
  .lead {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: baseline;
    min-width: 0;
    gap: 2px 10px;
  }
  .lead > .title {
    flex: 0 1 auto;
    max-width: 100%;
  }
  .at {
    flex: none;
    font-size: var(--text-xs);
    color: var(--color-subtle);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .headline.unread .title,
  .headline.hot .title {
    color: var(--color-foreground);
  }
  .draft,
  .pin,
  .pr {
    display: inline-flex;
    align-items: center;
    flex: none;
  }
  .pin {
    color: var(--color-subtle);
  }
  /* A draft left in the box: full ink, the user's own work waiting. */
  .draft {
    color: var(--color-foreground);
  }
  /* The pull request: its number in the row's quiet ink, its state in the glyph's tone only. */
  .pr {
    gap: 3px;
    font-size: var(--text-xs);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--color-subtle);
    cursor: pointer;
  }
  .pr:hover { color: var(--color-foreground); }
  .pr.merged :global(svg) { color: var(--color-success); }
  .pr.closed :global(svg) { color: var(--color-danger); }
</style>
