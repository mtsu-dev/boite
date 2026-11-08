<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { Check, Ellipsis, FolderInput } from '@lucide/svelte';
  import { type Project, type ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { canMove, moveBlocked, pendingLine, startThreadDrag, threadDrag } from '../lib/thread-move.svelte';
  import { pickThreadAction, threadMenuItems, threadToolItems } from '../lib/thread-menu';
  import { focusOnMount } from '../lib/actions';
  import { collapseRow } from '../lib/row-collapse';
  import { strings } from '../lib/strings';
  import ThreadHeadline, { pullRequestLabel } from './ThreadHeadline.svelte';
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
    at,
    ask,
    detail,
    action,
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
    /** Activity's row (ActivityRow.svelte): since when, at the end of the title's line, before `action`. */
    at?: number;
    /** Activity: what the thread asks, on the title's line when both fit, else under it, whole (ThreadHeadline.svelte). */
    ask?: Snippet;
    /** Activity: what runs under the title's line, whole: the command asked for, the sub-agents asking the same. */
    detail?: Snippet;
    /** Activity: the row's one action, at the end of the title's line, outside the row's own button; it wraps itself in `.feed-action`. */
    action?: Snippet;
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
    const options = { open, showDone, prLoading: pr.loading };
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
    out:collapseRow|global={() => !owner.threads.some(entry => entry.id === thread.id)}
    class="thread"
    class:open
    class:unread={thread.unread}
    class:pinned={thread.pinned}
    class:compact
    class:feed={detail !== undefined}
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
      <ThreadHeadline {owner} {thread} {now} {open} tile={compact ? project : undefined} {pullRequest} mark {ask} />
      {#if detail}
        <!-- Activity: who asks (the tile and the title, two lines of it) and what, on one line when it fits; the
             mark, the time and the one action end that line; a command runs whole under it. -->
        {@render detail()}
      {:else}
        {#if where}<span class="where ui-label" data-testid="thread-where">{where}</span>{/if}
      {/if}
      {#if pending}
        <span class="pending" data-testid="thread-pending" title={pending}><FolderInput size={12} /><span class="ui-label">{pending}</span></span>
      {/if}
    </button>
    {#if detail}<span class="feed-side">{#if at !== undefined}<time title={exactTime(at)}>{ago(at, now)}</time>{/if}{@render action?.()}</span>{/if}
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
    /* The room the row's own buttons take at its right edge: a 32 px hit area each, a phone's touch target. */
    --act: max(32px, var(--control-sm));
    --act-room: calc(var(--act) + 3px);
    --pad-x: 8px;
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
  .thread.offline .row,
  .thread.offline .row :global(*) {
    color: var(--color-subtle);
  }
  /* One line of 32 px: the title's 20 px line in 6 px of padding. */
  .row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: auto;
    min-height: 32px;
    padding: 6px var(--pad-x);
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
  /* Activity's row, built like a list row: the title's line ends in since when and the one action, at the same
     offset on every row; what is asked runs under it to the row's end. `--side-room` keeps that line's end free:
     the time alone in Updates, the time and the action in Needs you. */
  .feed { --feed-pad: 8px; --feed-time: 44px; --feed-verb: 92px; --side-room: calc(var(--feed-time) + var(--pad-x)); }
  .feed:has(:global(.feed-action)) { --side-room: calc(var(--feed-time) + 8px + var(--feed-verb) + var(--pad-x)); }
  .feed > .row { padding-block: var(--feed-pad); }
  .feed .row :global(.headline) { align-items: flex-start; margin-right: calc(var(--side-room) - var(--pad-x)); }
  /* A clamped title's second line keeps its untrimmed box: .ui-label's half-em under it showed the top of the third
     line, so only a descender's room is kept. */
  .feed .row :global(.headline .title) { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; padding-bottom: 0.25em; margin-bottom: -0.25em; }
  .feed .row :global(.headline > .tile) { margin-top: 2px; }
  /* The mark centred on the title's first 20 px line, like the time and the action beside it. */
  .feed .row :global(.headline > .when) { height: 20px; }
  .feed-side { position: absolute; top: 0; right: 0; display: flex; align-items: center; gap: 8px; height: calc(20px + 2 * var(--feed-pad)); padding-right: var(--pad-x); }
  .feed-side time { min-width: var(--feed-time); line-height: 20px; font-size: var(--text-xs); color: var(--color-subtle); text-align: end; font-variant-numeric: tabular-nums; }
  /* The menu takes the time's place, never the action's. */
  .feed .actions { top: calc(var(--feed-pad) + 10px - var(--act) / 2); }
  .feed:has(:global(.feed-action)) .actions { right: calc(var(--pad-x) + var(--feed-verb) + 8px); }
  /* Recent's second line, on the title's edge: where the row lives, when the tile alone may not say it. */
  .where { margin-top: -3px; padding-left: 26px; overflow: hidden; font-size: var(--text-xs); color: var(--color-muted-foreground); text-align: start; text-overflow: ellipsis; white-space: nowrap; }
  /* The Recent list: a step wider inside, the project's tile first. */
  .compact { --pad-x: 10px; }
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
  /* Centred on the title's line, 16 px down the row (6 px of padding, half its 20 px line). Nothing sits
     under them (the line below makes room), so they need no backing of their own. */
  .actions, .done {
    position: absolute;
    top: calc(16px - var(--act) / 2);
    opacity: 0;
  }
  .actions { right: 3px; }
  .done { right: calc(3px + var(--act)); color: var(--color-muted-foreground); }
  .thread:has(.done) { --act-room: calc(2 * var(--act) + 3px); }
  .thread:is(:hover, :focus-within) .done, .thread:is(:hover, :focus-within) .actions { opacity: 1; }
  /* While the buttons show, the title's line ends where they begin: the time gives up its place and a state
     steps left, whole, so they never cover a word. */
  .thread:not(.feed):is(:hover, :focus-within) .row > :global(.headline) { margin-right: calc(var(--act-room) + 4px - var(--pad-x)); }
  .thread:is(:hover, :focus-within) :global(.headline .when:not(.state)),
  .thread:is(:hover, :focus-within) .feed-side time { visibility: hidden; }
  .rename {
    width: 100%;
    height: 32px;
  }
  /* A phone has no pointer to wait for: the buttons always show, and the title's line always ends before them. */
  @media (max-width: 720px) {
    .done, .actions { opacity: 1; }
    .thread:not(.feed) .row > :global(.headline) { margin-right: calc(var(--act-room) + 4px - var(--pad-x)); }
  }
</style>
