<script lang="ts">
  import { openResident, residentOfThread } from '../lib/resident';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Bot, ChevronDown, Ellipsis, FolderInput, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, MessagesSquare, Search, UsersRound, VenetianMask } from '@lucide/svelte';
  import { focusOnMount } from '../lib/actions';
  import { needsAnAI } from '../lib/first-run';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { pendingLine } from '../lib/thread-move.svelte';
  import { pickThreadAction, threadMenuItems, threadToolItems } from '../lib/thread-menu';
  import { closeCoordination, coordinationRequest } from '../lib/coordination-request.svelte';
  import type { MenuItem } from '../lib/menu';
  import { fill, strings } from '../lib/strings';
  import { work } from '../lib/work-prefs.svelte';
  import type { Store } from '../lib/store.svelte';
  import type { ThreadSummary } from '@boite/contracts';
  import { projectName } from '../lib/format';
  import { machineName, workspace } from '../lib/workspace.svelte';
  import Menu from './Menu.svelte';
  import { ThreadRename, commitOnUnmount } from '../lib/thread-rename.svelte';
  import { watchStatus } from '../lib/pull-request-watch';
  import ContextModeBadge from './ContextModeBadge.svelte';
  import PanelDoor from './PanelDoor.svelte';
  import MachinePlace from './MachinePlace.svelte';
  import { hostMark } from '../lib/machine-host';
  import CoordinationDialog from './CoordinationDialog.svelte';
  import ThreadPullRequestProbe from './ThreadPullRequestProbe.svelte';
  import { pullRequestLabel } from './ThreadHeadline.svelte';
  import { openExternal } from '../lib/links';
  import PluginSlotButtons from './PluginSlotButtons.svelte';
  let { store }: { store: Store } = $props();
  let thread = $derived(store.openThread);
  const mobile = new MediaQuery('(max-width: 720px)');
  /** Under a phone's title: where the conversation lives, its machine once there are two. */
  let place = $derived.by(() => {
    if (!thread) return null;
    const project = thread.projectId ? store.projects.find(p => p.id === thread!.projectId) : undefined;
    const machines = workspace.machinesOr(store);
    // The machine's own name: "This computer" says nothing on a phone that reaches a remote one.
    const found = machines.length > 1 ? machines.find(m => m.store === store) : undefined;
    const where = { project: project ? projectName(project) : '', machine: found ? hostMark(machineName(found), found.store.connection) : null };
    return where.project || where.machine ? where : null;
  });
  /** How many panels the door holds, read beside its name. */
  let panelCount = $derived(thread ? store.panel.surfaces.length : 0);
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
  // The panel selector asks for the dialog; leaving the thread drops it.
  $effect(() => {
    if (coordinationRequest.threadId && (coordinationRequest.store !== store || thread?.id !== coordinationRequest.threadId)) closeCoordination();
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

  /** The agent this thread was entrusted to, if any. */
  let carrier = $derived(thread ? agentDirectory(store).entrustmentOf(thread.id) : null);
  /** A subagent's header starts with the conversation that started it: "parent / subagent". */
  let parentTitle = $derived(thread?.parentThreadId ? store.threads.find(entry => entry.id === thread!.parentThreadId)?.title ?? strings.delegation.parent : null);
  /** The agent the owner entrusted this thread's project to, when the thread itself is not entrusted. */
  let resident = $derived(thread ? residentOfThread(store, thread) : null);

  /**
   * Who holds the thread, first in its menu's named group: the bot it was
   * given to or the one that looks after its project. Each keeps the id of
   * the header chip it replaces.
   */
  let identity = $derived.by((): MenuItem[] => {
    if (!thread) return [];
    return [
      ...(carrier ? [{ id: 'thread-entrusted-chip', label: fill(strings.agents.openAgent, { name: carrier.agent.name }), title: fill(strings.agents.entrustedTo, { name: carrier.agent.name }), glyph: Bot }] : []),
      ...(resident ? [{ id: 'thread-resident-chip', label: fill(strings.agents.openAgent, { name: resident.name }), title: fill(strings.resident.lookedAfterBy, { name: resident.name }), glyph: Bot }] : [])
    ];
  });
  /** The thread's pull request, opened from its menu: a phone row draws no mark, and a desktop row's mark is pointer-only. */
  let pullRequest = $state<NonNullable<ThreadSummary['pullRequest']> | null>(null);
  /** Where it lives, first in the group's folder rows: its pull request, then its watches on a phone, its branch on a desktop. */
  let where = $derived.by((): MenuItem[] => {
    if (!thread) return [];
    const watches = thread.pullRequestWatches ?? [];
    const pr = pullRequest;
    return [
      ...(pr ? [{ id: 'thread-pr', label: pullRequestLabel(pr), title: pr.url, glyph: pr.state === 'MERGED' ? GitMerge : pr.state === 'CLOSED' ? GitPullRequestClosed : GitPullRequest }] : []),
      ...(mobile.current ? watches.map((watch): MenuItem => ({ id: `watch:${watch.url}`, label: fill(strings.tasks.stopWatchOf, { number: String(watch.number) }), hint: watchStatus(watch), title: watch.url, glyph: GitPullRequest })) : []),
      ...(thread.branch && work.shows('header.branch') && !mobile.current ? [{ id: 'thread-branch', label: thread.branch, title: `${thread.branch}: ${strings.thread.branchHint}: ${thread.cwd}`, glyph: GitBranch, clip: true }] : [])
    ];
  });

  /** The view's own tool, first on the menu. A phone has no Ctrl+F: this row is its way to the find bar. */
  let tools = $derived.by((): MenuItem[] => thread ? [{ id: 'find', label: strings.palette.find, glyph: Search }] : []);
  /**
   * One menu on a desktop and a phone: find, then the frequent actions, then
   * the named group, which opens in place (`Menu.svelte`): its bot, its title,
   * its folder, its pull request first. A phone's has no path.
   */
  let menuShown = $derived(thread ? threadMenuItems(store, thread, { tools, lead: identity, place: where, showDone: true, phone: mobile.current }) : []);
  /** The right-click's two levels, which the shared context menu swaps through the picks. */
  let toolItems = $derived(thread ? threadToolItems(store, thread, { lead: identity, place: where }) : []);
  let desktopItems = $derived(thread ? threadMenuItems(store, thread, { tools, lead: identity, place: where, showDone: true }) : []);
  /** Every row in view on a desktop: the first level and its group stay short, but a long bot name still wants the room. */
  const MENU_CAP = 560;
  function titleAction(action: string) {
    const open = store.openThread;
    if (!open) return;
    if (action === 'thread-entrusted-chip' && carrier) store.showAgents(carrier.agent.id);
    else if (action === 'thread-resident-chip' && resident) openResident(store, resident.id);
    else if (action === 'thread-branch' && open.branch) void store.copy(open.branch);
    else if (action === 'thread-pr' && pullRequest) void openExternal(pullRequest.url);
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
    const pick = (action: string): void => {
      if (action === 'more') return contextMenu.follow(toolItems, pick);
      if (action === 'back') return contextMenu.follow(desktopItems, pick);
      titleAction(action);
    };
    contextMenu.open(event, desktopItems, pick);
  }
</script>

{#if thread}{#key thread.id}<ThreadPullRequestProbe owner={store} {thread} bind:value={pullRequest} />{/key}{/if}
<div class="thread-header" data-testid="thread-header" data-status={thread?.status}>
      {#if thread}
        {#if thread.parentThreadId && !mobile.current}
          {@const parentId = thread.parentThreadId}
          <!-- A phone goes back to the parent with its one back arrow (MobileNavigation), so the crumb is the desktop's. -->
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
          {#if mobile.current}<span class="title-lines"><span class="title-text ui-label">{thread.title}</span>{#if place}<span class="title-place ui-label" data-testid="thread-place">{#if place.project}<span class="place-project">{place.project}</span>{/if}{#if place.machine}<MachinePlace host={place.machine} />{/if}</span>{/if}</span>{/if}
          <!-- A small chevron exposes thread actions on the desktop. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <span class="title-menu">
            <Menu items={menuShown} onpick={titleAction} cap={MENU_CAP} label={strings.sidebar.threadMenu} heading={thread?.title} placement="bottom" variant={mobile.current ? 'icon' : 'text'} testid="thread-menu-trigger">
              {#if mobile.current}<Ellipsis size={16} />{:else}<ChevronDown size={16} />{/if}
            </Menu>
          </span>
          <!-- The desktop's crumb names project and thread; the machine follows in the phone's muted form, once there are two. -->
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
        <span class="ui-chip incognito" title={strings.drafts.incognitoOn} aria-label={strings.drafts.incognitoOn} data-testid="thread-incognito">
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
      <!-- The door to the side panel, on a phone too; with a panel open it names it and switches it. -->
      {#if thread && store === workspace.primary}<PluginSlotButtons slot="thread-header" threadId={thread.id} />{/if}
      {#if thread}<PanelDoor {store} count={panelCount} ontoggle={() => store.togglePanel()} testid="panel-toggle" />{/if}
</div>

{#if coordinationRequest.threadId && coordinationRequest.store === store && thread?.id === coordinationRequest.threadId}
  <CoordinationDialog {store} threadId={coordinationRequest.threadId} onclose={closeCoordination} />
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
  /* After the title and its menu, in meta: the machine reads as where it runs, and gives way before the title does. */
  .title-menu :global(.trigger) { min-width: 32px; min-height: 32px; justify-content: center; }
  @media (max-width: 720px) {
    /* The title is what tells one conversation from another: the buttons give
       up their words for it, and keep a finger-sized square. */
    .thread-header { gap: 4px; }
    .pending { flex: none; min-width: var(--touch-target); justify-content: center; }
    .pending-text { display: none; }
    .trace { padding: 0; min-width: var(--touch-target); justify-content: center; }
    .trace .label, .incognito .label, .context-chip :global(.label) { display: none; }
    .context-chip :global(.ui-chip) { min-width: var(--touch-target); justify-content: center; }
    /* The header's one menu holds these on a phone. */
    .watch-chip { display: none; }
    .rename { width: 100%; }
    /* The thread's title button gives way to its menu; a team's name has no menu and stays. */
    .title:not(.team) { display: none; }
    .title.team { max-width: none; }
    /* Back, the title, then the menu at the row's end, whatever the header draws between. */
    .title-menu { order: 1; }
    /* app.css's icon button, its box as large as its 44 px target. */
    .title-menu :global(.trigger.icon-button) { margin: calc((var(--icon-button-target) - var(--icon-button)) / 2); }
    .title-lines { display: flex; flex: 1; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 0; line-height: 1.25; font-weight: 600; color: var(--color-foreground); }
    .title-lines ~ .spacer { display: none; }
    /* Two lines stacked: a label's ascender room and its trim to the capitals would pull the second over the first. */
    .title-lines > .ui-label { margin-block: 0; padding-block: 0; text-box: normal; }
    /* A long title takes a second line rather than losing its end. */
    .title-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; max-width: 100%; min-width: 0; overflow: hidden; white-space: normal; overflow-wrap: anywhere; line-height: 1.2; }
    .title-place { display: flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; white-space: nowrap; font-size: var(--text-xs); font-weight: 400; color: var(--color-muted-foreground); }
    /* The machine label stays whole (its root is `MachinePlace`'s, hence global); the project name gives way. */
    .place-project { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .title-place > :global(:not(.place-project)) { flex: none; }
    .crumb { min-height: var(--touch-target); }
    .crumb-sep { margin: 0; }
  }
</style>
