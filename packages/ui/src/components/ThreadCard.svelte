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
  import MachinePlace from './MachinePlace.svelte';
  import type { RowPlace } from '../lib/row-place';
  import ThreadHeadline, { pullRequestLabel } from './ThreadHeadline.svelte';
  import ThreadState from './ThreadState.svelte';
  import { threadState } from '../lib/thread-state';
  import { rowAsks, stateForm } from '../lib/status-order';
  import { wordFit } from '../lib/word-fit';
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
    lead,
    detail,
    action,
    where,
    placed = false
  }: {
    machine: Machine;
    project: Project | undefined;
    thread: ThreadSummary;
    now: number;
    /** In a folded project: the card waits for the unfold to look up its pull request. */
    hidden?: boolean;
    /** The quick action puts finished work in Done. */
    showDone?: boolean;
    /** Recent's flat list: the project's tile leads the row while no place line names the project (`where`). */
    compact?: boolean;
    /** Activity's Needs you row (ActivityRow.svelte): since when, at the end of its place line. */
    at?: number;
    /** Activity: the kind line over the title, the card's one mark (ActivityKind.svelte). */
    lead?: Snippet;
    /** Activity: what runs under the place line, whole: what is asked, the command, the sub-agents asking the same. */
    detail?: Snippet;
    /** Activity: the row's decision pair, under its content at the row's right edge, outside the row's own button. */
    action?: Snippet;
    /** Recent and Activity: where the row lives (its project, its machine among several), when the tile alone may
        not tell rows apart (lib/row-place.ts, lib/feed-row.ts). */
    where?: RowPlace;
    /** The card above names the machine and says it is out of reach: the row only mutes its title. */
    placed?: boolean;
  } = $props();
  let owner = $derived(machine.store);
  const away = $derived(owner.connection !== 'ready');
  const kind = $derived(thread.archived ? null : threadState(thread, rowAsks(owner, thread.id)));
  /** "Offline" said once: on the place line, unless the card's head, the place's machine or the row's own state
      (work it last saw, ThreadState.svelte) already says it. */
  const chip = $derived(away && !placed && !where?.host?.away && stateForm(kind) !== 'work');
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
    class:led={lead !== undefined}
    class:offline={away}
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
      {#if lead}<span class="kind-line">{@render lead()}</span>{/if}
      <!-- Every list row ends its title's line the same way: the mark when there is one, then the time of the
           last message. An Activity card's mark is its kind line's glyph, its time on another line; a card with no
           kind (work going on under a sub-agent that asks) wears the row's mark in that glyph's place. -->
      {#if detail}
        <span class="title-line">{#if !lead && stateForm(kind) !== null}<span class="lone-mark"><ThreadState {thread} {now} subagents={rowAsks(owner, thread.id)} {away} mark /></span>{/if}<ThreadHeadline {owner} {thread} {open} {pullRequest} offline={away} /></span>
      {:else}
        <ThreadHeadline {owner} {thread} {now} {open} tile={compact && !where ? project : undefined} {pullRequest} fit offline={away} at={thread.lastUserMessageAt ?? thread.createdAt} />
      {/if}
      <!-- Where the row lives, under the title: the project, the machine among several, Offline once. -->
      {#if where || chip || (detail && at !== undefined)}
        <span class="where" data-testid="thread-where" title={where?.text}>{#if where?.project}<span class="ui-label" use:wordFit={where.project}></span>{/if}{#if where?.host}<MachinePlace host={where.host} />{/if}{#if chip}<span class="away" data-testid="thread-offline">{strings.connection.offline}</span>{/if}{#if detail && at !== undefined}<time class="since ui-label" title={exactTime(at)}>{ago(at, now)}</time>{/if}</span>
      {/if}
      {#if pending}
        <span class="pending" data-testid="thread-pending" title={pending}><FolderInput size={12} /><span class="ui-label">{pending}</span></span>
      {/if}
    </button>
    <!-- Activity: what is asked, then the command and the sub-agents asking the same; outside the row's button, since
         a long text unfolds with a button of its own (ClampText.svelte). -->
    {#if detail}<div class="feed-detail">{@render detail()}</div>{/if}
    {#if action}<div class="feed-actions">{@render action()}</div>{/if}
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
    font-size: var(--text-body);
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
  /* One line of 34 px: the title's 20 px line in 7 px of padding, the chat's looser rhythm rather than a packed
     table. A title too long for its line takes a second one. */
  .row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: auto;
    min-height: 34px;
    padding: 7px var(--pad-x);
    gap: 4px;
    border-radius: inherit;
    background: transparent;
    container: thread-row / inline-size;
  }
  /* The title wins. At rest a row, the open one included, carries one state at most (its mark and its word,
     ThreadState.svelte), then its time. The pin, a draft and the pull request show under the
     pointer or the keyboard (a click's focus does not count: the row just opened would keep them), and stay in
     the tooltip; how long work has run lives in the thread. */
  .thread:not(:hover, :has(:focus-visible)) .row :global(.headline > :is(.draft, .pin, .pr)) { display: none; }
  /* Activity's card, one form for every entry (ActivityList.svelte draws its surface): the kind line, its glyph the
     card's one mark, then the title, two lines at most, the place line under it, where the row lives and since when;
     what is asked runs under that, the decision pair beside the title or under everything. Every line after the kind
     line starts on its word's edge (the glyph's 13 px and its 6 px gap, ActivityKind.svelte). One padding on every
     side, and one right edge for the pair, the menu and a command's block. The type steps down from the title: the
     kind line and the place line small in the secondary inks, what is asked at the body's size. */
  .feed { --pad-x: 12px; --feed-pad: 12px; --feed-lead: 0px; --gutter: 19px; --menu-w: var(--act); --menu-h: 20px; --menu-at: 8px; }
  /* A kind line over the title: its 16 px and a 12 px step, which also keeps the menu on it clear of the pair. */
  .feed.led { --feed-lead: 28px; }
  .kind-line { display: block; margin: 0 calc(var(--menu-w) + 4px) 8px 0; }
  /* No button border on the card's row: its words start on the same edge as the detail and the pair under it. */
  .feed > .row { padding-block: var(--feed-pad) 0; border-inline-width: 0; }
  .feed-detail { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px var(--pad-x) var(--feed-pad) calc(var(--pad-x) + var(--gutter)); }
  /* Nothing asked (an update): the row keeps its own bottom padding only. */
  .feed-detail:not(:has(*)) { padding: 0 0 var(--feed-pad); }
  .title-line { position: relative; display: flex; align-items: flex-start; min-width: 0; padding-left: var(--gutter); }
  /* No kind line: the menu stays on the title's first line, which keeps its room, and the row's mark stands in the
     glyph's column, on the middle of the title's capitals. */
  .feed:not(.led) { --menu-at: calc(0.36 * var(--text-head)); }
  .feed:not(.led) .title-line { margin-right: calc(var(--menu-w) + 4px); }
  .lone-mark { position: absolute; left: 0; top: calc(0.36 * var(--text-head) - 10px); display: flex; height: 20px; align-items: center; }
  .title-line > :global(.headline) { flex: 1; align-items: flex-start; }
  /* The card's strongest line. A clamped title's second line keeps its untrimmed box: .ui-label's half-em under it
     showed the top of the third line, so only a descender's room is kept. */
  .feed .row :global(.headline .title) { flex: 0 1 auto; font-size: var(--text-head); font-weight: var(--weight-title); white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; padding-bottom: 0.25em; margin-bottom: -0.25em; }
  .feed .row :global(.headline > :is(.tile, .bot, .provider)) { margin-top: 2px; }
  /* The menu at the kind line's end, its glyph's box on the card's right edge, so the title keeps the card's width. */
  .feed .actions { top: calc(var(--feed-pad) + var(--menu-at) - var(--menu-h) / 2); right: calc(var(--pad-x) - (var(--menu-w) - 14px) / 2); width: var(--menu-w); height: var(--menu-h); min-height: 0; }
  /* The place line under the title, a descender's room and the row's 4 px clear of it, one line: the project gives
     way at a word, then the machine. Every item is trimmed to its capitals (.ui-label) and centred, so all stand on
     one baseline. */
  .feed .where { height: 20px; line-height: 20px; margin: 2px 0 0 var(--gutter); }
  /* The pair answers what is asked, right under it: right-aligned on the card's edge. */
  .feed-actions { padding: 0 var(--pad-x) var(--feed-pad); margin-top: -2px; }
  /* Where Activity has room (ActivityList.svelte's three columns), the title block takes the page's first column, the
     pair the next two, the outline action in one and the solid one in the next, so every pair lines up on the card's
     edge, centred on the title's first line (its capitals' middle, 0.36 em into its trimmed box). What is asked runs
     under them, the card's whole width, so no empty band parts the text from the pair. */
  @container activity (min-width: 640px) {
    .thread.feed { display: grid; grid-template-columns: subgrid; align-items: start; }
    .thread.feed > .row { grid-column: 1; grid-row: 1; }
    .feed-detail { grid-column: 1 / -1; grid-row: 2; }
    .feed-actions { grid-column: 2 / -1; grid-row: 1; display: grid; grid-template-columns: subgrid; margin: 0; padding: calc(var(--feed-pad) + var(--feed-lead) + 0.36 * var(--text-head) - var(--control) / 2) var(--pad-x) 0 0; }
    .feed-actions > :global(.decision-actions) { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; gap: 0; }
    .feed-actions :global(.decision-actions > button) { grid-column: 2; }
    .feed-actions :global(.decision-actions > button:not(:last-child)) { grid-column: 1; margin: 0 8px 0 var(--space-4); }
  }
  /* Recent's second line, on the title's edge: where the row lives, in words, so no tile repeats it. One fixed line,
     whatever it holds (a name, a machine with its icon, an Offline chip), with room for the descenders the overflow
     would cut. */
  .where { display: flex; align-items: center; gap: 8px; min-width: 0; height: 18px; line-height: 18px; margin-top: -2px; overflow: hidden; font-size: var(--text-xs); color: var(--color-subtle); text-align: start; white-space: nowrap; }
  .where :global(.away) { padding-block: 0; line-height: 14px; }
  .where > .ui-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  /* "Offline" when nothing above says it: MachinePlace's state mark, alone. */
  .where > .away { flex: none; padding-inline: 6px; border: 1px solid var(--color-edge); border-radius: var(--radius-sm); color: var(--color-muted-foreground); }
  /* Activity's since when, last on the place line: the title line keeps its room for the title. */
  .where > .since { flex: none; font-variant-numeric: tabular-nums; }
  /* The title's room first: its mark and time sit a step closer than the headline's own gap. */
  .row :global(.headline) { gap: 6px; }
  /* The keyboard reads the whole title: the focused row's title wraps, and word-fit (lib/word-fit.ts) shows it uncut
     once its line is no longer one. The pointer gets it in the tooltip, so the list never moves under it. */
  .thread:not(.feed) .row:focus-visible :global(.headline .title) { display: block; -webkit-line-clamp: none; line-clamp: none; }
  /* A list row's title wraps to a second line rather than dying mid-word (word-fit honours the clamp); its marks and
     time stay on the first line, centred on its capitals: .ui-label trims the title's box to them, so the line
     opens 5 px down and their middle sits 0.36 em under that. */
  .thread:not(.feed) .row :global(.headline) { align-items: flex-start; padding-top: 5px; }
  .thread:not(.feed) .row :global(.headline .title) { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; padding-bottom: 0.25em; margin-bottom: -0.25em; }
  .thread:not(.feed) .row :global(.headline > :is(.when, .at, .bot, .provider, .draft, .pin, .pr)) { height: 20px; margin-top: calc(0.36 * var(--text-body) - 10px); }
  /* The time on the same line whether the row's mark draws it (no state) or the row does. */
  .thread:not(.feed) .row :global(.headline > :is(.at, .when:not(.state))) { line-height: 20px; }
  .thread:not(.feed) .row :global(.headline > .tile) { margin-top: calc(0.36 * var(--text-body) - 8px); }
  /* The Recent list keeps the cards' insets and gaps, so its titles get the same room (about 30 characters). */
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
  /* Centred on the title's first line, 17 px down the row (7 px of padding, half its 20 px line). Nothing sits
     under them (the line below makes room), so they need no backing of their own. */
  .actions, .done {
    position: absolute;
    top: calc(17px - var(--act) / 2);
    opacity: 0;
  }
  .actions { right: 3px; }
  .done { right: calc(3px + var(--act)); color: var(--color-muted-foreground); }
  .thread:has(.done) { --act-room: calc(2 * var(--act) + 3px); }
  .thread:is(:hover, :focus-within) .done, .thread:is(:hover, :focus-within) .actions { opacity: 1; }
  /* While the buttons show, the title's line ends where they begin: the time gives up its place and a state
     steps left, whole, so they never cover a word. */
  .thread:not(.feed):is(:hover, :focus-within) .row > :global(.headline) { margin-right: calc(var(--act-room) + 4px - var(--pad-x)); }
  .thread:is(:hover, :focus-within) :global(.headline .when:not(.state)) { visibility: hidden; }
  /* The time leaves its room to the title rather than to an empty slot. */
  .thread:not(.feed):is(:hover, :focus-within) :global(.headline > .at) { display: none; }
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
