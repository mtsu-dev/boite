<script lang="ts">
  import { tick } from 'svelte';
  import { Check, Ellipsis, FolderInput } from '@lucide/svelte';
  import { type Project, type ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { canMove, moveBlocked, pendingLine, startThreadDrag, threadDrag } from '../lib/thread-move.svelte';
  import { pickThreadAction, threadMenuItems, threadToolItems } from '../lib/thread-menu';
  import { focusOnMount } from '../lib/actions';
  import { strings } from '../lib/strings';
  import ThreadHeadline, { pullRequestLabel } from './ThreadHeadline.svelte';
  import ThreadState from './ThreadState.svelte';
  import { threadState } from '../lib/thread-state';
  import { ago, exactTime } from '../lib/format';
  import { trackThreadPullRequest } from '../lib/thread-pull-request.svelte';
  import { canMarkDone, markDone } from '../lib/recent.svelte';
  import { ThreadRename, commitOnUnmount } from '../lib/thread-rename.svelte';
  let {
    machine,
    project,
    thread,
    now,
    hidden = false,
    showDone = false,
    compact = false,
    reason,
    at,
    nested = false,
    where
  }: {
    machine: Machine;
    project: Project | undefined;
    thread: ThreadSummary;
    now: number;
    /** In a folded project: the card waits for the unfold to look up its pull request. */
    hidden?: boolean;
    /** The quick action puts finished work in Done. */
    showDone?: boolean;
    /** Recent's flat list: the project's tile leads the row, since no card names it. */
    compact?: boolean;
    /** Activity's row: the title and since when (`at`) on its line, then what the thread wants, or where it lives. */
    reason?: string;
    at?: number;
    /** Activity: a sub-agent under its parent's row. */
    nested?: boolean;
    /** Recent: where the row lives (its project, its machine among several), when the tile alone may not tell rows apart (lib/row-place.ts). */
    where?: string;
  } = $props();
  let owner = $derived(machine.store);
  let open = $derived(workspace.active === owner && owner.openThread?.id === thread.id);
  /** The rename in progress, bound to the machine and thread it began on. */
  let renaming = $state<ThreadRename | null>(null);
  commitOnUnmount(() => renaming);
  const pr = trackThreadPullRequest(() => ({ owner, thread, hidden }));
  const pullRequest = $derived(pr.value);
  // A move asked for while the turn runs, until the turn ends and applies it.
  let pending = $derived(pendingLine(thread));
  let doneAllowed = $derived(canMarkDone(owner, thread));
  /** Activity's section already says the user's turn: the reason line names any other state before the reason. */
  let feedState = $derived(reason === undefined ? null : threadState(thread, owner.subagents(thread.id)));
  /** The details the row only shows under the pointer or the keyboard, in its tooltip at rest: the pull request, the branch, the time. */
  let tip = $derived([thread.title, pullRequest && pullRequestLabel(pullRequest), thread.branch, ago(thread.lastUserMessageAt ?? thread.createdAt, now)].filter(Boolean).join('\n'));

  function rename() {
    renaming = new ThreadRename(owner, thread.id, thread.title);
  }
  async function save() {
    const current = renaming;
    renaming = null;
    await current?.commit();
  }
  let row = $state<HTMLButtonElement | undefined>(undefined);
  /** Enter and Escape hand the keyboard back to the row, never to the page, where Escape stops the turn. */
  async function leaveRename(commit: boolean) {
    if (commit) void save();
    else {
      renaming?.cancel();
      renaming = null;
    }
    await tick();
    row?.focus({ preventScroll: true });
  }
  /** A row moves to another project when dragged onto its section, under the menu's rule, unless a sub-thread still works. */
  let movable = $derived(canMove(thread) && !moveBlocked(owner, thread.id));
  function dragStart(event: PointerEvent) {
    if (movable) startThreadDrag(event, owner, { machineId: machine.id, threadId: thread.id, projectId: thread.projectId }, { title: thread.title, providerId: thread.providerId });
  }
  /** The common actions first; All tools opens the rest in the same place, and Back returns. */
  function menu(event: MouseEvent) {
    const options = { open, showDone, prLoading: pr.loading, grouped: true };
    const main = threadMenuItems(owner, thread, options);
    const pick = (action: string): void => {
      if (action === 'more') return contextMenu.follow(threadToolItems(owner, thread, options), pick);
      if (action === 'back') return contextMenu.follow(main, pick);
      pickThreadAction(owner, thread, action, { rename, refreshPr: () => void pr.refresh(true) });
    };
    contextMenu.open(event, main, pick);
  }
</script>

{#if renaming}
  <input
    class="rename"
    data-testid="thread-rename"
    value={renaming.text}
    oninput={(event) => { if (renaming) renaming.text = event.currentTarget.value; }}
    use:focusOnMount
    onblur={() => void save()}
    onkeydown={(event) => {
      if (event.key === 'Enter') void leaveRename(true);
      if (event.key === 'Escape') void leaveRename(false);
    }}
  />
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="thread"
    class:open
    class:unread={thread.unread}
    class:pinned={thread.pinned}
    class:compact
    class:feed={reason !== undefined}
    class:nested
    class:offline={owner.connection !== 'ready'}
    class:dragging={threadDrag.current?.threadId === thread.id && threadDrag.current.machineId === machine.id}
    data-movable={movable}
    onpointerdown={dragStart}
    ondragstart={(event) => event.preventDefault()}
    oncontextmenu={menu}
  >
    <button
      type="button"
      class="ghost row"
      bind:this={row}
      data-testid="thread-row"
      data-thread-id={thread.id}
      data-machine-id={machine.id}
      data-preload-thread={thread.id}
      data-status={thread.status}
      data-pinned={thread.pinned ? 'true' : undefined}
      title={tip}
      onclick={() => void workspace.select(owner, thread.id)}
      ondblclick={rename}
    >
      {#if reason !== undefined}
        <span class="feed-head"><ThreadHeadline {owner} {thread} {open} tile={compact && !nested ? project : undefined} {pullRequest} />{#if at !== undefined}<time title={exactTime(at)}>{ago(at, now)}</time>{/if}</span>
        <span class="reason" data-testid="thread-reason">{#if feedState !== null && feedState !== 'waiting'}<ThreadState {thread} {now} subagents={owner.subagents(thread.id)} away={owner.connection !== 'ready'} /><span class="sep" aria-hidden="true">·</span>{/if}<span class="text">{reason}</span></span>
      {:else}
        <ThreadHeadline {owner} {thread} {now} {open} tile={compact && !nested ? project : undefined} {pullRequest} mark />
        {#if where}<span class="where ui-label" data-testid="thread-where">{where}</span>{/if}
      {/if}
      {#if pending}
        <span class="pending" data-testid="thread-pending" title={pending}><FolderInput size={12} /><span class="ui-label">{pending}</span></span>
      {/if}
    </button>
    {#if showDone && doneAllowed}<button type="button" class="ghost small icon done" data-testid="thread-done"
      aria-label={strings.sidebar.markDone} title={strings.sidebar.markDone} onclick={() => void markDone(owner, thread)}><Check size={14} /></button>{/if}
    <button
      type="button"
      class="ghost small icon actions"
      data-testid="thread-menu"
      aria-label={strings.sidebar.threadMenu}
      title={strings.sidebar.threadMenu}
      onclick={menu}><Ellipsis size={15} /></button
    >
  </div>
{/if}

<style>
  .thread {
    position: relative;
    border-radius: var(--radius-md);
    font-size: 13.5px;
    transition: background var(--dur-2) var(--ease-out-quint);
  }
  .thread:hover {
    background: var(--color-hover);
  }
  .thread.open {
    background: var(--color-active);
  }
  /* The row left behind while its card travels: an empty slot, so the list does not jump. */
  .thread.dragging {
    background: var(--color-hover);
    outline: 1px dashed var(--color-edge);
    outline-offset: -1px;
  }
  .thread.dragging > * {
    opacity: 0.35;
  }
  /* A row on the move: the hand closes over the whole page, and no text gets selected on the way. */
  :global(html.thread-dragging),
  :global(html.thread-dragging *) {
    cursor: grabbing !important;
    user-select: none;
  }
  /* Its machine dropped: the row still opens, to read what is held and queue a prompt. */
  .thread.offline .row {
    opacity: 0.55;
  }
  /* One line of 32 px: the title's 20 px line in 6 px of padding. */
  .row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: auto;
    min-height: 32px;
    padding: 6px 8px;
    gap: 4px;
    border-radius: inherit;
    background: transparent;
    container: thread-row / inline-size;
  }
  /* The title wins. At rest a row, the open one included, carries one mark at most: the user's turn as its dot,
     work as its ring, a failure as its word. The pin, a draft, the pull request, the time and news show under the
     pointer or the keyboard (a click's focus does not count: the row just opened would keep them), and stay in
     the tooltip; how long work has run lives in the thread. */
  .thread:not(:hover, :has(:focus-visible)) .row :global(.headline > :is(.draft, .pin, .pr)),
  .thread:not(:hover, :has(:focus-visible)) .row :global(.headline > .when:not(.waiting, .error, .interrupted, .working, .delegating, .monitoring, .background, .watching)) { display: none; }
  /* Activity's row, as the phone's: the title and since when on one line, then the state when the section does
     not say it, and the reason, whole. */
  .feed-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .feed-head :global(.headline) { flex: 1; }
  .feed-head time { flex: none; font-size: var(--text-xs); color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  .reason { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); text-align: start; }
  .reason .text { flex: 0 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
  .reason .sep { flex: none; color: var(--color-subtle); }
  .compact.feed:not(.nested) .reason { padding-left: 26px; }
  /* Recent's second line, on the title's edge: where the row lives, when the tile alone may not say it. */
  .where { margin-top: -3px; padding-left: 26px; overflow: hidden; font-size: var(--text-xs); color: var(--color-subtle); text-align: start; text-overflow: ellipsis; white-space: nowrap; }
  .nested { margin-left: 26px; }
  /* The Recent list: a step wider inside, the project's tile first. */
  .compact .row { padding: 6px 10px; }
  .compact :global(.headline) { gap: 10px; }
  .row:hover:not(:disabled) {
    background: transparent;
  }
  .row:active:not(:disabled) {
    transform: none;
  }
  /* A move waiting for the turn's end, like the marker the move leaves in the chat. */
  .pending {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .pending span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pending :global(svg) {
    flex: none;
  }
  /* Centred on the title's line, 21 px under the row's 1 px border and top padding: 26 px buttons at 5 px
     sat 1.5 px above it. A whole pixel keeps the icons sharp, so they stay half a pixel high. */
  .actions {
    position: absolute;
    right: 3px;
    top: 3px;
    opacity: 0;
    background: var(--color-surface-2);
  }
  .done { position: absolute; right: 30px; top: 3px; opacity: 0; background: var(--color-surface-2); color: var(--color-muted-foreground); }
  .thread:hover .done, .thread:focus-within .done { opacity: 1; }
  .thread:hover .actions,
  .thread:focus-within .actions {
    opacity: 1;
  }
  /* The menu button takes the time's place; a state steps left of it and stays. */
  .thread:hover :global(.headline .when:not(.state)),
  .thread:focus-within :global(.headline .when:not(.state)),
  .thread:hover .feed-head time,
  .thread:focus-within .feed-head time {
    opacity: 0;
  }
  .thread:hover :global(.headline .when.state),
  .thread:focus-within :global(.headline .when.state) {
    margin-right: 22px;
  }
  .thread:has(.done):hover :global(.headline .when.state), .thread:has(.done):focus-within :global(.headline .when.state) { margin-right: 49px; }
  .thread:has(.done):hover :global(.headline .when:not(.state)), .thread:has(.done):focus-within :global(.headline .when:not(.state)) { margin-right: 27px; }
  .rename {
    width: 100%;
    height: 32px;
  }
  @media (max-width: 720px) {
    .done { opacity: 1; }
    .thread:has(.done) :global(.headline .when) { margin-right: 49px; }
    .actions {
      opacity: 1;
    }
    .thread :global(.headline .when) {
      margin-right: 22px;
    }
  }
</style>
