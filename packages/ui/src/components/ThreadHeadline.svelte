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
  import { rowAsks, rowSaysState } from '../lib/status-order';
  import { GitMerge, GitPullRequest, GitPullRequestClosed, PencilLine, Pin } from '@lucide/svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { hasUnsentDraft } from '../lib/composer-queue';
  import { threadState } from '../lib/thread-state';
  import { openExternal } from '../lib/links';
  import { agentLabel, ago, exactTime } from '../lib/format';
  import { wordFit } from '../lib/word-fit';
  import ProjectTile from './ProjectTile.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import ThreadState from './ThreadState.svelte';

  /**
   * Every thread row's one line, in the sidebar, Recent, Activity and a phone's
   * lists: the title takes the width, then an unsent draft, the pin, the pull
   * request when there is one, and the state at the end, in one slot, with the
   * time after it. The provider's mark leads the title in its own colours, so
   * the model behind each row reads at a glance. A flat list (`tile`) shows the
   * project's tile, since no card names it, and keeps the provider mark when
   * a bot is named below. The state is its mark and its word; `fit` lets the
   * word give way on a narrow desktop list (ThreadState.svelte). `ask` (Activity) is one line under the title, which
   * keeps the row's width. `at` is the row's time (its last message in the
   * lists, since when in Activity): it follows the mark, and stands alone when
   * there is none. The title is cut between words (lib/word-fit.ts).
   * `offline`: its machine is out of reach. The title steps down to the muted
   * ink, as a Machines row does, so the row stays readable instead of fading
   * whole; the word "Offline" is said once, by the card's head or on the row's
   * place line (ThreadCard.svelte, MobileThreadRow.svelte), never on the title's
   * line, where it would push the title to a second one.
   */
  let {
    owner,
    thread,
    now,
    open = false,
    tile,
    showProvider = false,
    pullRequest = null,
    fit = false,
    ask,
    at,
    offline = false,
    elapsedShownSince
  }: {
    owner: Store;
    thread: ThreadSummary;
    /** Without it the row draws the state itself, elsewhere. */
    now?: number;
    /** The open thread shows its box: its row marks no draft. */
    open?: boolean;
    /** The project's tile, in a list that mixes projects. */
    tile?: Project;
    /** Keep the provider visible beside a project tile when a bot is named below. */
    showProvider?: boolean;
    /** The thread's pull request, looked up by the row. */
    pullRequest?: ThreadSummary['pullRequest'];
    fit?: boolean;
    ask?: Snippet;
    at?: number;
    offline?: boolean;
    elapsedShownSince?: number | null;
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

<span class="headline" class:unread={thread.unread} class:hot={open || kind !== null} class:offline>
  {#if tile}<ProjectTile project={tile} store={owner} size={16} />{/if}
  {#if !tile || showProvider}<span class="provider" title={agentLabel(owner, thread)} data-testid="thread-provider"><ProviderLogo providerId={thread.providerId} size={14} /></span>{/if}
  {#if ask}<span class="lead"><span class="title ui-label" use:wordFit={thread.title}></span>{@render ask()}</span>{:else}<span class="title ui-label" use:wordFit={thread.title}></span>{/if}
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
  {#if now !== undefined && (at === undefined || rowSaysState(thread.archived ? null : kind))}<ThreadState {thread} {now} subagents={rowAsks(owner, thread.id)} team={owner.subagents(thread.id)} away={owner.connection !== 'ready'} {fit} {elapsedShownSince} />{/if}
  {#if now !== undefined && at !== undefined && elapsedShownSince == null}<time class="at" title={exactTime(at)}>{ago(at, now)}</time>{/if}
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
    /* The row's primary line at full ink on every row; time and place are its secondary, a size down in the subtle
       ink. The body's weight: bold is for the card's title above it. */
    color: var(--color-foreground);
    font-weight: 400;
  }
  /* Activity: the title first, on the row's width, and what is asked as one line under its edge. */
  .lead {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: stretch;
    min-width: 0;
    gap: 2px;
  }
  .lead > .title {
    flex: none;
  }
  /* The row's time and quiet marks: meta, a size under the title and in the subtle ink (11:1 still), so title,
     place and time part at a glance. */
  .at,
  .headline > :global(.when:not(.state)) {
    color: var(--color-subtle);
  }
  .at {
    flex: none;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* Only an elapsed clock replaces the last message's age; work with no known start keeps that age. */
  .headline:has(:global(.state > .time)) > .at { display: none; }
  .headline.unread .title,
  .headline.hot .title {
    color: var(--color-foreground);
  }
  /* Out of reach: the title in the muted ink (MachinesPage's away status). */
  .headline.offline .title {
    color: var(--color-muted-foreground);
  }
  .provider,
  .draft,
  .pin,
  .pr {
    display: inline-flex;
    align-items: center;
    flex: none;
  }
  .pin {
    color: var(--color-muted-foreground);
  }
  /* A draft left in the box: the accent, so it reads as the user's own work waiting. */
  .draft {
    color: var(--color-accent);
  }
  /* The pull request: its number in the row's quiet ink, its state in the glyph's tone only. */
  .pr {
    gap: 3px;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-subtle);
    cursor: pointer;
  }
  .pr:hover { color: var(--color-foreground); }
  .pr.merged :global(svg) { color: var(--color-success); }
  .pr.closed :global(svg) { color: var(--color-danger); }
</style>
