<script lang="ts">
  import { tick } from 'svelte';
  import { Check, Ellipsis, FolderInput, Pin, PinOff } from '@lucide/svelte';
  import { type Project, type ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { namesMachine } from '../lib/row-machine';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { canMove, moveBlocked, pendingLine, startThreadDrag, threadDrag } from '../lib/thread-move.svelte';
  import { pickThreadAction, threadMenuItems } from '../lib/thread-menu';
  import { focusOnMount } from '../lib/actions';
  import { fill, strings } from '../lib/strings';
  import ThreadHeadline from './ThreadHeadline.svelte';
  import MachineIcon from './MachineIcon.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import { trackThreadPullRequest } from '../lib/thread-pull-request.svelte';
  import { projectName } from '../lib/format';
  import { canMarkDone, markDone } from '../lib/recent.svelte';
  import { threadState } from '../lib/thread-state';
  import { rowSubagents } from '../lib/delegated-work';
  import { ThreadRename, commitOnUnmount } from '../lib/thread-rename.svelte';
  let {
    machine,
    project,
    thread,
    now,
    hidden = false,
    showDone = false,
    showProject = true,
    showMachine = true,
    pin = true
  }: {
    machine: Machine;
    project: Project;
    thread: ThreadSummary;
    now: number;
    /** In a folded project: the card waits for the unfold to look up its pull request. */
    hidden?: boolean;
    /** The quick action puts finished work in Done. */
    showDone?: boolean;
    /** Off under the project's own header, where the folder line would only repeat it. */
    showProject?: boolean;
    /** Off while only one machine is connected, and under a project header, which already shows it. */
    showMachine?: boolean;
    /** Off under Recent's band labels: the Pinned one says it, the title keeps the room, and a Needs you title may take two lines (`ThreadHeadline`). */
    pin?: boolean;
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
  /**
   * A row is one line: the ring, the title, the time. A second line says
   * where a row belongs when the list mixes projects, or a move waiting for the
   * turn's end; it then takes the machine and, at its right end, the time and
   * the delegated agents, so the first line is the ring and the title alone.
   * The branch and the pull request are on the open thread's header and in the
   * row's tooltip; delegated agents show while the row is open or under the
   * pointer (`ThreadHeadline`). Under a project's header, a row also takes that
   * line when it has a failure to word, as a Recent row does: "Failed" under the
   * title, then the pin and the time. A pinned row with nothing else to say keeps
   * one line, its pin just before the time.
   */
  let kind = $derived(threadState(thread, rowSubagents(owner, thread.id)));
  let failed = $derived(owner.connection === 'ready' && (kind === 'error' || kind === 'interrupted'));
  let meta = $derived(showProject || Boolean(pending) || failed);
  let prLabel = $derived(pullRequest ? fill(pullRequest.state === 'MERGED' ? strings.sidebar.prMerged : pullRequest.state === 'CLOSED' ? strings.sidebar.prClosed : strings.sidebar.prOpen, { number: String(pullRequest.number) }) : null);
  let tooltip = $derived([thread.title, thread.branch, prLabel].filter(Boolean).join('\n'));
  let doneAllowed = $derived(canMarkDone(owner, thread));

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
  function menu(event: MouseEvent) {
    contextMenu.open(
      event,
      threadMenuItems(owner, thread, { open, showDone, prLoading: pr.loading }),
      (action) => pickThreadAction(owner, thread, action, { rename, refreshPr: () => void pr.refresh(true) })
    );
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
    class:meta
    class:grouped={!showProject}
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
      title={tooltip}
      onclick={() => void workspace.select(owner, thread.id)}
      ondblclick={rename}
    >
      {#snippet facts()}
        {#if pending}<span class="fact pending" data-testid="thread-pending" title={pending}><FolderInput size={12} /><span class="ui-label">{pending}</span></span>{/if}
        {#if showProject}<span class="fact project-name" data-testid="thread-project" title={project.path}><ProjectTile {project} store={owner} size={12} /><span class="ui-label">{projectName(project)}</span></span>{/if}
        <!-- The project's own logo says where the row belongs. The machine is named only when it is not this one (`namesMachine`),
             after the project in the form "· Failed" takes: a dot kept from the accessible name, then its glyph and its name. -->
        {#if showMachine && namesMachine(machine, owner.connection !== 'ready')}<span class="fact machine" class:offline={owner.connection !== 'ready'} data-testid="thread-machine" title={`${machine.label} · ${strings.connection[owner.connection]}`}><span class="dot" aria-hidden="true">·</span><MachineIcon icon={machine.icon} os={owner.core?.os} size={12} /><span class="ui-label">{machine.label}</span></span>{/if}
      {/snippet}
      <ThreadHeadline {owner} {thread} {now} {open} {pin} ring facts={meta ? facts : undefined} machine={showMachine && !meta ? machine : undefined} />
    </button>
    <!-- Pin on hover; a pinned row keeps its 12 px mark beside the time, on the second line when it has one. -->
    <button type="button" class="ghost small icon pin-action" data-testid="thread-pin" aria-pressed={thread.pinned === true}
      aria-label={thread.pinned ? strings.sidebar.unpin : strings.sidebar.pin} title={thread.pinned ? strings.sidebar.unpin : strings.sidebar.pin}
      onclick={() => void owner.pin(thread.id, !thread.pinned)}>{#if thread.pinned}<PinOff size={13} />{:else}<Pin size={13} />{/if}</button>
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
    transition: background var(--dur-2) var(--ease-out-quint);
  }
  .thread:hover {
    background: var(--color-hover);
  }
  .thread.open {
    background: var(--color-active);
  }
  /* On the hovered or open row's darker ground the time takes the meta tier, 5:1 where subtle gave 4.3. */
  .thread:is(.open, :hover, :focus-within) {
    --when-color: var(--color-meta);
  }
  /* The row left behind while its card travels: an empty slot, so the list does not jump. */
  .thread.dragging {
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    outline: 1px dashed color-mix(in srgb, var(--color-accent) 55%, transparent);
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
  /* One line is 28 px: the 22 px slot and 3 px of air above and below, no border,
     so eight project headers and their rows fit a 900 px screen. */
  .row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: auto;
    min-height: 28px;
    padding: 3px 4px 3px 3px;
    border-width: 0;
    gap: 0;
    background: transparent;
  }
  /* Two lines in one 44 px target: the title's, then the project, the machine and the time. */
  .meta .row {
    min-height: 44px;
    justify-content: center;
    gap: 2px;
    padding: 3px 8px 3px 4px;
  }
  /* Under a project's header its one-line rows set the edges: the ring and the time keep their column. */
  .grouped.meta .row { padding: 3px 4px 3px 3px; }
  /* and their 13 px title: a row taking a second line for its failure keeps the card's one size. */
  .grouped.meta .row :global(.headline.stacked .title) { font-size: var(--text-sm); }
  .row:hover:not(:disabled) {
    background: transparent;
  }
  .row:active:not(:disabled) {
    transform: none;
  }
  .fact {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 1 auto;
    min-width: 0;
  }
  .fact span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fact :global(svg) {
    flex: none;
  }
  /* A move waiting for the turn's end: the accent, like the marker the move leaves in the chat. */
  .pending { color: var(--color-accent); }
  .machine.offline { color: var(--color-danger); }
  /* The dot stands 8 px from the glyph, as "· Failed" stands from its word. */
  .machine .dot { flex: none; margin-right: 4px; }
  /* A 12 px tile: its letter a size down so it stays inside. */
  .project-name :global(.tile.letter) { font-size: 9px; font-weight: 600; }
  /* Centred on the title's line: the 28 px row less a 26 px button leaves 1 px over it. */
  .actions {
    position: absolute;
    right: 3px;
    top: 1px;
    opacity: 0;
    background: var(--color-surface-2);
  }
  .done { position: absolute; right: 30px; top: 1px; opacity: 0; background: var(--color-surface-2); color: var(--color-muted-foreground); }
  .pin-action { position: absolute; right: 30px; top: 1px; opacity: 0; background: var(--color-surface-2); color: var(--color-muted-foreground); }
  .thread:has(.done) .pin-action { right: 57px; }
  .thread:hover .done, .thread:focus-within .done, .thread:hover .pin-action, .thread:focus-within .pin-action { opacity: 1; }
  .thread:hover .actions,
  .thread:focus-within .actions {
    opacity: 1;
  }
  /* Delegated agents at work show on the open row and under the pointer; one that asks always shows, it needs the user. */
  .thread:not(.open):not(:hover):not(:focus-within) :global(:is(.headline, .facts) > * > .agents:not(.asking)),
  .thread:not(.open):not(:hover):not(:focus-within) :global(.headline > .agents:not(.asking)) { display: none; }
  /* The buttons take the time's place on hover: a resting time hides, a counting one steps left and stays. */
  /* On a two-line row the time sits on the second line, clear of the buttons: it stays. */
  .thread:not(.meta):hover :global(.headline .when:not(.live)),
  .thread:not(.meta):focus-within :global(.headline .when:not(.live)) {
    opacity: 0;
  }
  .thread:not(.meta):hover :global(.headline .when.live), .thread:not(.meta):focus-within :global(.headline .when.live) { margin-right: 51px; }
  .thread:not(.meta):has(.done):hover :global(.headline .when.live), .thread:not(.meta):has(.done):focus-within :global(.headline .when.live) { margin-right: 78px; }
  .rename {
    width: 100%;
    height: var(--row);
  }
  /* On touch the buttons stay drawn, so the time keeps clear of them. */
  @media (max-width: 720px), (hover: none) {
    /* A finger keeps the 32 px row it had. */
    .row { min-height: 32px; padding-block: 5px; }
    .done, .pin-action, .actions { top: 3px; }
    .done { opacity: 1; }
    /* Touch pins from the row's menu: three buttons would leave the title no room. */
    .pin-action { display: none; }
    .actions {
      opacity: 1;
    }
    .thread:not(.meta) :global(.headline .when) {
      opacity: 1 !important;
      margin-right: 24px;
    }
    .thread:not(.meta):has(.done) :global(.headline .when) { margin-right: 51px; }
    /* A two-line row keeps its title clear of the drawn buttons instead; the time stays under them. */
    .meta .row :global(.headline) { padding-right: 24px; }
    .meta:has(.done) .row :global(.headline) { padding-right: 51px; }
  }
</style>
