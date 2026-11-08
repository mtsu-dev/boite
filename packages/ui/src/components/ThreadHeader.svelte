<script lang="ts">
  import { openResident, residentOfThread } from '../lib/resident';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Bot, ChevronDown, Ellipsis, FolderInput, GitBranch, GitPullRequest, Globe, MessagesSquare, Network, PanelRight, Search, SquareKanban, SquareTerminal, UsersRound, VenetianMask } from '@lucide/svelte';
  import { focusOnMount } from '../lib/actions';
  import { needsAnAI } from '../lib/first-run';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { pendingLine } from '../lib/thread-move.svelte';
  import { pickThreadAction, threadMenuItems } from '../lib/thread-menu';
  import { separator, type MenuItem } from '../lib/menu';
  import { fill, strings } from '../lib/strings';
  import { work } from '../lib/work-prefs.svelte';
  import type { SurfaceKind } from '../lib/right-panel.svelte';
  import { available, kindName, offeredCards } from '../lib/surface-labels';
  import { surfaceGlyph } from '../lib/surface-glyphs';
  import type { Store } from '../lib/store.svelte';
  import { projectName } from '../lib/format';
  import { workspace } from '../lib/workspace.svelte';
  import Menu from './Menu.svelte';
  import { ThreadRename, commitOnUnmount } from '../lib/thread-rename.svelte';
  import { watchStatus } from '../lib/pull-request-watch';
  import ContextModeBadge from './ContextModeBadge.svelte';
  import CoordinationDialog from './CoordinationDialog.svelte';
  let { store }: { store: Store } = $props();
  const inShell = window.__TAURI_INTERNALS__ !== undefined;
  let thread = $derived(store.openThread);
  const mobile = new MediaQuery('(max-width: 720px)');
  /** Under a phone's title: where the conversation lives, its machine once there are two. */
  let place = $derived.by(() => {
    if (!thread) return '';
    const project = thread.projectId ? store.projects.find(p => p.id === thread!.projectId) : undefined;
    const machines = workspace.machinesOr(store);
    return [project ? projectName(project) : null, machines.length > 1 ? machines.find(m => m.store === store)?.label : null].filter(Boolean).join(' · ');
  });
  /** The project's name, the first half of a desktop header's "where": project, then title. */
  let projectLabel = $derived.by(() => {
    const id = thread?.projectId;
    const project = id ? store.projects.find(p => p.id === id) : undefined;
    return project ? projectName(project) : null;
  });

  /**
   * The desktop's way back: the thread list, shown again if a panel had
   * taken its column, scrolled to this thread's row, which takes the focus.
   */
  async function backToList() {
    const id = store.openThread?.id;
    if (store.sidebarCollapsed) store.toggleSidebar();
    await tick();
    const row = id ? document.querySelector<HTMLElement>(`[data-testid="thread-row"][data-thread-id="${CSS.escape(id)}"]`) : null;
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
  }

  /** The rename in progress, bound to the thread it began on rather than to whatever is open later. */
  let rename = $state<ThreadRename | null>(null);
  commitOnUnmount(() => rename);
  let coordinationThreadId = $state<string | null>(null);
  $effect(() => {
    if (thread?.id !== coordinationThreadId) coordinationThreadId = null;
  });

  function beginRename() {
    const thread = store.openThread;
    if (!thread) return;
    rename = new ThreadRename(store, thread.id, thread.title);
  }

  // Another surface opened a different thread under the input: the title typed so far still goes to the thread it was typed for.
  $effect(() => {
    if (rename && rename.threadId !== thread?.id) {
      void rename.commit();
      rename = null;
    }
  });

  // The palette asks for a rename from outside this header.
  $effect(() => {
    if (!store.renameRequested) return;
    store.renameRequested = false;
    beginRename();
  });

  async function commitRename() {
    const current = rename;
    rename = null;
    await current?.commit();
  }

  let titleButton = $state<HTMLButtonElement | undefined>(undefined);

  /** Enter and Escape give the keyboard back to the title, never to the page, where Escape stops the turn. */
  async function onRenameKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitRename();
    } else if (event.key === 'Escape') {
      rename?.cancel();
      rename = null;
    } else return;
    await tick();
    titleButton?.focus({ preventScroll: true });
  }

  let agentsOn = $derived(store.panelOpen && store.panel.active?.kind === 'agents');
  /** The agent this thread was entrusted to, if any. */
  let carrier = $derived(thread ? agentDirectory(store).entrustmentOf(thread.id) : null);
  /** A subagent's header starts with the conversation that started it: "parent / subagent". */
  let parentTitle = $derived(thread?.parentThreadId ? store.threads.find(entry => entry.id === thread!.parentThreadId)?.title ?? strings.delegation.parent : null);
  /** The agent the owner entrusted this thread's project to, when the thread itself is not entrusted. */
  let resident = $derived(thread ? residentOfThread(store, thread) : null);

  /** A labelled rule: the menu draws its words as the start of a section. */
  const section = (id: string, label: string): MenuItem => ({ ...separator(id), label });

  /**
   * What the thread is, first in its menu: the bot that holds or looks after
   * it, its pull request watches and its branch. Each keeps the id of the
   * header chip it replaces.
   */
  let identity = $derived.by((): MenuItem[] => {
    if (!thread) return [];
    const watches = thread.pullRequestWatches ?? [];
    return [
      ...(carrier ? [{ id: 'thread-entrusted-chip', label: fill(strings.agents.openAgent, { name: carrier.agent.name }), title: fill(strings.agents.entrustedTo, { name: carrier.agent.name }), glyph: Bot }] : []),
      ...(resident ? [{ id: 'thread-resident-chip', label: fill(strings.agents.openAgent, { name: resident.name }), title: fill(strings.resident.lookedAfterBy, { name: resident.name }), glyph: Bot }] : []),
      ...(mobile.current ? watches.map((watch): MenuItem => ({ id: `watch:${watch.url}`, label: fill(strings.tasks.stopWatchOf, { number: String(watch.number) }), hint: watchStatus(watch), title: watch.url, glyph: GitPullRequest })) : []),
      ...(thread.branch && work.shows('header.branch') && !mobile.current ? [{ id: 'thread-branch', label: thread.branch, title: `${thread.branch}: ${strings.thread.branchHint}: ${thread.cwd}`, glyph: GitBranch }] : [])
    ];
  });

  let tools = $derived.by((): MenuItem[] => {
    if (!thread) return [];
    return [
      // A phone has no Ctrl+F: this sheet is its way to the find bar.
      { id: 'find', label: strings.palette.find, glyph: Search },
      { id: 'agents', label: strings.delegation.heading, glyph: UsersRound, active: agentsOn },
      ...(!thread.agentSessionId ? [{ id: 'coordination', label: strings.coordination.heading, glyph: Network }] : [])
    ];
  });
  let desktopItems = $derived(thread ? [...identity, ...(identity.length ? [separator('sep-identity')] : []), ...threadMenuItems(store, thread, { tools })] : []);

  /** Children delegated from this thread, at work or done, its CLI's own agents included: the phone offers Subagents only then. */
  let delegated = $derived(!!thread && (store.subagents(thread.id) !== null || store.threads.some(row => row.parentThreadId === thread!.id)
    || (store.delegation?.agents.length ?? 0) > 0 || (store.delegation?.nativeAgents?.length ?? 0) > 0));
  const shows = (kind: SurfaceKind) => store.panelOpen && store.panel.active?.kind === kind;

  /**
   * The panels this thread opens beside it, in the header's panel menu: the
   * bot's desk on its own thread, the cards this device offers, then the
   * drawers under the chat (the owner's terminal, the project board).
   */
  let panelItems = $derived.by((): MenuItem[] => {
    if (!thread) return [];
    const kinds: SurfaceKind[] = [...(thread.agentSessionId ? ['desk' as const] : []), ...offeredCards().map(card => card.kind)];
    const terminalKey = store.keyLabel('terminal');
    const drawers: MenuItem[] = [
      ...(store.owner && !thread.teamId && !thread.councilId && work.shows('header.terminal') ? [{
        id: 'terminal-toggle', label: strings.terminal.title, glyph: SquareTerminal, active: store.terminalShown(thread.id),
        title: terminalKey ? `${strings.thread.terminalHint} (${terminalKey})` : strings.thread.terminalHint
      }] : []),
      ...(store.boardAvailable() ? [{ id: 'board-toggle', label: strings.board.open, glyph: SquareKanban, active: store.boardShown }] : [])
    ];
    return [
      ...kinds.filter(kind => available(kind, inShell, store.owner)).map((kind): MenuItem => ({ id: `kind:${kind}`, label: kindName(kind), glyph: surfaceGlyph(kind), active: shows(kind) })),
      ...(drawers.length ? [separator('sep-drawers'), ...drawers] : [])
    ];
  });

  function panelPick(id: string) {
    if (id === 'terminal-toggle') store.toggleTerminal();
    else if (id === 'board-toggle') store.toggleBoard();
    else if (id.startsWith('kind:')) store.panel.open(id.slice('kind:'.length) as SurfaceKind);
  }

  /**
   * A phone's one header menu, in two labelled sections: where to go (the
   * thread's main tools, at most six with "All tools", the panel and its
   * cards, for the rest), then what to do to the thread (its bot, its
   * watches, pin, rename, hand off, archive, delete). Contact requests live
   * in the Activity tab.
   */
  let phoneItems = $derived.by((): MenuItem[] => {
    if (!thread) return [];
    return [
      section('sec-tools', strings.thread.toolsSection),
      { id: 'changes', label: strings.rightPanel.changes, glyph: surfaceGlyph('changes'), active: shows('changes') },
      { id: 'phone-browser-toggle', label: strings.rightPanel.browser, glyph: Globe, active: shows('agent-browser') },
      ...(delegated || agentsOn ? [{ id: 'agents', label: strings.delegation.heading, glyph: UsersRound, active: agentsOn }] : []),
      ...(store.boardAvailable() ? [{ id: 'board', label: strings.board.open, glyph: SquareKanban, active: store.boardShown }] : []),
      { id: 'find', label: strings.palette.find, glyph: Search },
      { id: 'panel', label: strings.thread.allTools, glyph: PanelRight, active: store.panelOpen },
      section('sec-thread', strings.thread.threadSection),
      ...identity,
      ...threadMenuItems(store, thread, { phone: true })
    ];
  });

  function titleAction(action: string) {
    const open = store.openThread;
    if (!open) return;
    if (action === 'coordination') coordinationThreadId = open.id;
    else if (action === 'panel') store.togglePanel();
    else if (action === 'board') store.toggleBoard();
    else if (action === 'agents') store.panel.toggleKind('agents');
    else if (action === 'phone-browser-toggle') store.panel.open('agent-browser');
    else if (action === 'changes') store.panel.open(action);
    else if (action === 'thread-entrusted-chip' && carrier) store.showAgents(carrier.agent.id);
    else if (action === 'thread-resident-chip' && resident) openResident(store, resident.id);
    else if (action === 'thread-branch' && open.branch) void store.copy(open.branch);
    else if (action.startsWith('watch:')) void store.unwatchPullRequest(open.id, action.slice('watch:'.length));
    else if (action === 'find') {
      store.findOpen = true;
      store.findRequest += 1;
    }
    // From a phone's sheet the pickers hang under the title; from a right-click, where that menu stood.
    else pickThreadAction(store, open, action, { rename: beginRename, anchor: () => document.querySelector<HTMLElement>('[data-testid="thread-menu-trigger"]') });
  }

  function openTitleMenu(event: MouseEvent) {
    if (!store.openThread) return;
    contextMenu.open(event, desktopItems, titleAction);
  }
</script>

<div class="thread-header" data-testid="thread-header" data-status={thread?.status}>
      {#if thread}
        {#if thread.parentThreadId}
          {@const parentId = thread.parentThreadId}
          <button type="button" class="ghost crumb" data-testid="delegation-back-parent" data-preload-thread={parentId} title={strings.delegation.parent} onclick={() => void store.open(parentId)}>
            <span class="ui-label">{parentTitle}</span>
          </button>
          <span class="crumb-sep" aria-hidden="true">/</span>
        {:else if projectLabel && !mobile.current && !thread.teamId && !thread.councilId}
          <button type="button" class="ghost crumb" data-testid="thread-project-crumb" title={fill(strings.thread.backToList, { project: projectLabel })} onclick={() => void backToList()}>
            <span class="ui-label">{projectLabel}</span>
          </button>
          <span class="crumb-sep" aria-hidden="true">/</span>
        {/if}
        {#if rename}
          <input
            class="rename"
            value={rename.text}
            oninput={(event) => { if (rename) rename.text = event.currentTarget.value; }}
            onkeydown={onRenameKey}
            onblur={() => void commitRename()}
            placeholder={strings.thread.renamePlaceholder}
            data-testid="thread-rename-input"
            use:focusOnMount
          />
        {:else if thread.teamId}
          <!-- A team's chat takes its team's name and no thread action: the core refuses them on a chat that runs no agent. -->
          <span class="title team" data-testid="thread-title" title={thread.title}><UsersRound size={15} strokeWidth={1.75} /><span class="ui-label">{thread.title}</span></span>
        {:else if thread.councilId}
          <!-- A council's salon runs no agent either: its title is the council's, and it has no thread action. -->
          <span class="title team" data-testid="thread-title" title={thread.title}><MessagesSquare size={15} strokeWidth={1.75} /><span class="ui-label">{thread.title}</span></span>
        {:else}
          <button
            type="button"
            class="ghost title"
            bind:this={titleButton}
            data-testid="thread-title"
            title={strings.common.rename}
            onclick={beginRename}
            oncontextmenu={openTitleMenu}
          >
            <span class="ui-label">{thread.title}</span>
          </button>
          <!-- On a phone the title reads as text over its place, and the one menu closes the header's row. -->
          {#if mobile.current}<span class="title-lines"><span class="title-text ui-label">{thread.title}</span>{#if place}<span class="title-place ui-label" data-testid="thread-place">{place}</span>{/if}</span>{/if}
          <!-- A small chevron exposes thread actions on the desktop. -->
          <span class="title-menu">
            <Menu items={mobile.current ? phoneItems : desktopItems} onpick={titleAction} label={strings.sidebar.threadMenu} heading={thread?.title} placement="bottom" variant={mobile.current ? 'ghost' : 'text'} testid="thread-menu-trigger">
              {#if mobile.current}<Ellipsis size={20} />{:else}<ChevronDown size={14} />{/if}
            </Menu>
          </span>
        {/if}
        {@const pending = pendingLine(thread)}
        {#if pending}
          <!-- A move asked for while the turn runs. A phone keeps only the mark; its sidebar row carries the words. -->
          <span class="pending" data-testid="thread-pending" title={pending} aria-label={pending}>
            <FolderInput size={13} strokeWidth={1.75} /><span class="pending-text ui-label">{pending}</span>
          </span>
        {/if}
      {/if}
      <!-- A draft has no name yet: no crumb, only its incognito switch on the right. -->

      <span class="spacer"></span>

      <!-- Incognito is chosen before the first send, in the drafts only. -->
      {#if !thread && store.draftInDrafts && !needsAnAI(store)}
        {@const on = store.draft?.incognito === true}
        <button
          type="button"
          class="ghost trace"
          class:on
          title={on ? strings.drafts.incognitoStop : strings.drafts.incognitoStart}
          aria-label={strings.drafts.incognito}
          aria-pressed={on}
          data-testid="draft-incognito"
          onclick={() => store.setDraftIncognito(!on)}
        >
          <VenetianMask size={16} strokeWidth={1.75} />
          <span class="label">{strings.drafts.incognito}</span>
        </button>
      {:else if thread?.incognito}
        <span class="chip incognito" title={strings.drafts.incognitoOn} aria-label={strings.drafts.incognitoOn} data-testid="thread-incognito">
          <VenetianMask size={13} strokeWidth={1.75} />
          <span class="label">{strings.drafts.incognito}</span>
        </span>
      {/if}

      {#if thread?.contextMode}
        <span class="context-chip"><ContextModeBadge mode={thread.contextMode} testid="thread-context-mode" /></span>
      {/if}

      {#if thread && (thread.pullRequestWatches?.length ?? 0) > 0}
        {@const watches = thread.pullRequestWatches ?? []}
        <!-- What a watch saw and its Stop; a phone finds them in its menu. -->
        <span class="watch-chip" data-testid="thread-watches">
          <Menu
            items={watches.map((watch): MenuItem => ({ id: watch.url, label: fill(strings.tasks.stopWatchOf, { number: String(watch.number) }), hint: watchStatus(watch), title: watch.url, glyph: GitPullRequest }))}
            onpick={(url) => void store.unwatchPullRequest(thread.id, url)}
            label={strings.tasks.watchSection}
            placement="bottom"
            testid="thread-watches-trigger"
          >
            <GitPullRequest size={13} strokeWidth={1.75} /><span class="ui-label">{watches.map((watch) => `#${watch.number}`).join(' ')}</span>
          </Menu>
        </span>
      {/if}
      <!-- One panel control: the button shows or hides the side panel, its
           chevron lists the panels and the drawers under the chat. A paired
           device opens it too; the list offers only what available() allows.
           A team's chat has no title menu: a phone keeps this button, its one way to the panel. -->
      {#if thread}
        <span class="panel-switch" class:in-title-menu={!thread.teamId && !thread.councilId} class:on={store.panelOpen}>
          <button
            type="button"
            class="ghost icon"
            title={`${strings.thread.panelHint}${store.keyHint('panel')}`}
            aria-label={strings.thread.panelHint}
            aria-pressed={store.panelOpen}
            data-testid="panel-toggle"
            onclick={() => store.togglePanel()}
          >
            <PanelRight size={16} strokeWidth={1.75} />
          </button>
          {#if panelItems.length}
            <Menu items={panelItems} onpick={panelPick} label={strings.thread.panelMenu} placement="bottom" align="end" variant="ghost" testid="panel-menu">
              <ChevronDown size={12} strokeWidth={1.75} />
            </Menu>
          {/if}
        </span>
      {/if}
</div>

{#if coordinationThreadId && thread?.id === coordinationThreadId}
  <CoordinationDialog {store} threadId={coordinationThreadId} onclose={() => coordinationThreadId = null} />
{/if}

<style>
  .thread-header { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 100%; }
  .title {
    height: var(--control);
    padding: 0 6px;
    margin-left: -6px;
    font-weight: 550;
    color: var(--color-foreground);
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
  }

  .title > .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title.team { gap: 6px; margin-left: 0; }
  .title.team > :global(svg) { flex: none; color: var(--color-muted-foreground); }

  /* The field's 1 px border and 10 px padding stand left of its text, so the text starts where the title's did. */
  .rename {
    height: var(--control);
    width: min(420px, 50%);
    margin-left: -11px;
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }


  /* The panel button and its list read as one control: one hover, one fill when the panel is open. */
  .panel-switch { display: inline-flex; flex: none; align-items: center; border-radius: var(--radius-md); }
  .panel-switch > button { width: var(--control-sm); height: var(--control-sm); border-radius: var(--radius-md) 0 0 var(--radius-md); }
  .panel-switch :global(.trigger.ghost) { width: 18px; border-radius: 0 var(--radius-md) var(--radius-md) 0; }
  .panel-switch:not(:has(.menu)) > button { border-radius: var(--radius-md); }
  .panel-switch.on { background: var(--color-active); }
  .panel-switch.on > button { color: var(--color-foreground); }
  .watch-chip { flex: none; display: inline-flex; color: var(--color-muted-foreground); }
  .watch-chip :global(svg) { flex: none; }

  .trace {
    flex: none;
    padding: 0 10px 0 8px;
  }
  /* The parent's title, muted, then a slash: the subagent's own title reads last, in full weight. */
  .crumb {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 30%;
    height: var(--control);
    padding: 0 6px;
    margin-left: -6px;
    color: var(--color-muted-foreground);
    font-weight: 500;
  }
  .crumb > .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crumb:hover { color: var(--color-foreground); }
  .crumb-sep { flex: none; margin: 0 -4px; color: var(--color-subtle); }
  .crumb-sep + .title { margin-left: 0; }
  .incognito { gap: 4px; flex: none; }
  .context-chip { display: contents; }

  .on {
    background: var(--color-active);
    color: var(--color-foreground);
  }


  .pending {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }
  .pending :global(svg) { flex: none; }
  .pending-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .title { min-width: 0; }
  .title-menu { display: flex; flex: none; }
  @media (max-width: 720px) {
    /* The title is what tells one conversation from another: the buttons give
       up their words for it, and keep a finger-sized square. */
    .thread-header { gap: 4px; }
    .pending { flex: none; min-width: var(--touch-target); justify-content: center; }
    .pending-text { display: none; }
    .trace { padding: 0; min-width: var(--touch-target); justify-content: center; }
    .trace .label, .incognito .label, .context-chip :global(.label) { display: none; }
    .context-chip :global(.chip) { min-width: var(--touch-target); justify-content: center; }
    /* The header's one menu holds these on a phone. */
    .in-title-menu, .watch-chip { display: none; }
    .panel-switch :global(.menu) { display: none; }
    .panel-switch > button { width: var(--touch-target); height: var(--touch-target); }
    .rename { width: 100%; }
    /* The thread's title button gives way to its menu; a team's name has no menu and stays. */
    .title:not(.team) { display: none; }
    .title.team { max-width: none; }
    /* Back, the title, then the menu at the row's end, whatever the header draws between. */
    .title-menu { order: 1; }
    .title-menu :global(.trigger) { width: var(--touch-target); height: var(--touch-target); padding: 0; justify-content: center; color: var(--color-muted-foreground); }
    .title-lines { display: flex; flex: 1; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 0; line-height: 1.25; font-weight: 600; color: var(--color-foreground); }
    .title-lines ~ .spacer { display: none; }
    /* Two lines stacked: a label's ascender room and its trim to the capitals would pull the second over the first. */
    .title-lines > .ui-label { margin-block: 0; padding-block: 0; text-box: normal; }
    .title-text { display: block; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title-place { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); font-weight: 400; color: var(--color-muted-foreground); }
    .crumb { min-height: var(--touch-target); }
    .crumb-sep { margin: 0; }
  }
</style>
