<script lang="ts">
  import AgentAvatar from './agents/AgentAvatar.svelte';
  import { openResident, residentOfThread } from '../lib/resident';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import { entrust } from '../lib/thread-entrust';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Bot, ChevronDown, Folder, FolderInput, GitBranch, GitPullRequest, MessagesSquare, Monitor, Network, PanelRight, Search, SquareKanban, UsersRound, VenetianMask } from '@lucide/svelte';
  import { copyText } from '../lib/contacts.svelte';
  import { focusOnMount } from '../lib/actions';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { pendingLine } from '../lib/thread-move.svelte';
  import { pickThreadAction, threadMenuItems } from '../lib/thread-menu';
  import { separator, type MenuItem } from '../lib/menu';
  import { fill, strings } from '../lib/strings';
  import { work } from '../lib/work-prefs.svelte';
  import { controlMenu } from '../lib/controls';
  import type { Store } from '../lib/store.svelte';
  import { projectName } from '../lib/format';
  import { workspace } from '../lib/workspace.svelte';
  import Menu from './Menu.svelte';
  import { ThreadRename, commitOnUnmount } from '../lib/thread-rename.svelte';
  import { watchStatus } from '../lib/pull-request-watch';
  import ContextModeBadge from './ContextModeBadge.svelte';
  import CoordinationDialog from './CoordinationDialog.svelte';
  import ThreadPullRequest from './ThreadPullRequest.svelte';
  import { firstRunSteps } from '../lib/first-run.svelte';
  import { launcherItems, pickLauncher } from '../lib/panel-launcher';
  import { PanelCounts } from '../lib/panel-strip.svelte';
  import { longPress } from '../lib/long-press';
  let { store }: { store: Store } = $props();
  let thread = $derived(store.openThread);
  const mobile = new MediaQuery('(max-width: 720px)');
  /**
   * Under a phone's title: the project, the machine only when it is not the
   * one this app is connected to, and the branch; the PR number follows from
   * ThreadPullRequest. The branch gives way first, the project last.
   */
  let placeProject = $derived.by(() => {
    if (!thread) return '';
    const project = thread.projectId ? store.projects.find(p => p.id === thread!.projectId) : undefined;
    const machine = store !== workspace.primary && workspace.machinesOr(store).length > 1 ? workspace.machinesOr(store).find(m => m.store === store)?.label : null;
    return [project ? projectName(project) : null, machine].filter(Boolean).join(' · ');
  });
  let placeBranch = $derived(thread?.branch && work.shows('header.branch') ? thread.branch : '');
  let place = $derived([placeProject, placeBranch].filter(Boolean).join(' · '));
  /** The subtitle cuts the branch; the phone's title menu reads each value whole and copies it in one tap. */
  let pullRequest = $state<NonNullable<typeof thread>['pullRequest']>(null);
  let copiedPlace = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let placeValues = $derived.by((): { id: string; kind: string; value: string; label: string; glyph: MenuItem['glyph'] }[] => {
    if (!thread) return [];
    const project = thread.projectId ? store.projects.find(p => p.id === thread!.projectId) : undefined;
    const machine = workspace.machinesOr(store).find(m => m.store === store)?.label;
    return [
      ...(project ? [{ id: 'copy-project', kind: strings.thread.placeProject, value: projectName(project), label: projectName(project), glyph: Folder }] : []),
      ...(machine ? [{ id: 'copy-machine', kind: strings.thread.placeMachine, value: machine, label: machine, glyph: Monitor }] : []),
      ...(placeBranch ? [{ id: 'copy-branch', kind: strings.thread.placeBranch, value: placeBranch, label: placeBranch, glyph: GitBranch }] : []),
      ...(pullRequest ? [{ id: 'copy-pr', kind: strings.thread.placePullRequest, value: pullRequest.url, label: pullRequest.url.replace(/^https?:\/\//, ''), glyph: GitPullRequest }] : [])
    ];
  });
  async function copyPlace(id: string) {
    const entry = placeValues.find(value => value.id === id);
    if (!entry || !(await copyText(entry.value))) return;
    copiedPlace = id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copiedPlace = null; }, 1600);
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

  /** Every surface with its count, for the panel button's list (`lib/panel-launcher.ts`). */
  const panelCounts = new PanelCounts(() => store);
  let launcher = $derived(thread ? launcherItems(store, (kind) => panelCounts.of(kind), store.panelOpen ? store.panel.active?.kind ?? null : null) : []);
  let agentsOn = $derived(store.panelOpen && store.panel.active?.kind === 'agents');
  let tools = $derived.by((): MenuItem[] => {
    if (!thread) return [];
    return [
      // A phone has no Ctrl+F: this sheet is its way to the find bar.
      { id: 'find', label: strings.palette.find, glyph: Search },
      { id: 'agents', label: strings.delegation.heading, glyph: UsersRound, active: agentsOn },
      ...(!thread.agentSessionId ? [{ id: 'coordination', label: strings.coordination.heading, glyph: Network }] : [])
    ];
  });
  let desktopItems = $derived(thread ? threadMenuItems(store, thread, { tools }) : []);

  /** Children delegated from this thread, at work or done, its CLI's own agents included: the phone offers Subagents only then. */
  let delegated = $derived(!!thread && (store.subagents(thread.id) !== null || store.threads.some(row => row.parentThreadId === thread!.id)
    || (store.delegation?.agents.length ?? 0) > 0 || (store.delegation?.nativeAgents?.length ?? 0) > 0));
  /**
   * A phone's title menu holds the panel and the
   * project board, ticked when open, then the thread's own actions. The
   * terminal, the coordination and what only the desktop does with a thread stay there.
   */
  let phoneItems = $derived.by((): MenuItem[] => {
    if (!thread) return [];
    return [
      ...placeValues.map((entry): MenuItem => ({ id: entry.id, label: entry.label, hint: copiedPlace === entry.id ? strings.chat.copied : entry.kind, glyph: entry.glyph, copy: true, title: fill(strings.thread.copyPlace, { kind: entry.kind.toLowerCase() }) })),
      ...(placeValues.length ? [separator('sep-place')] : []),
      { id: 'panel', label: strings.thread.panelMenu, glyph: PanelRight, active: store.panelOpen },
      ...(store.boardAvailable() ? [{ id: 'board', label: strings.board.open, glyph: SquareKanban, active: store.boardShown }] : []),
      // The bot's face sits in the subtitle, inside this menu's trigger: its actions are here.
      ...(carrier ? [{ id: 'agent-open', label: fill(strings.agents.openAgent, { name: carrier.agent.name }), glyph: Bot },
        ...(store.owner ? [{ id: 'agent-back', label: strings.agents.takeBack }] : [])]
        : resident ? [{ id: 'agent-open', label: fill(strings.agents.openAgent, { name: resident.name }), glyph: Bot }] : []),
      separator('sep-panel'),
      ...threadMenuItems(store, thread, { phone: true, tools: [
        { id: 'find', label: strings.palette.find, glyph: Search },
        ...(delegated || agentsOn ? [{ id: 'agents', label: strings.delegation.heading, glyph: UsersRound, active: agentsOn }] : [])
      ] })
    ];
  });

  function titleAction(action: string) {
    const open = store.openThread;
    if (!open) return;
    if (action.startsWith('copy-')) void copyPlace(action);
    else if (action === 'coordination') coordinationThreadId = open.id;
    else if (action === 'panel') store.togglePanel();
    else if (action === 'board') store.toggleBoard();
    else if (action === 'agent-open') { if (carrier) store.showAgents(carrier.agent.id); else if (resident) openResident(store, resident.id); }
    else if (action === 'agent-back') void entrust(store, open.id, null);
    else if (action === 'agents') store.panel.toggleKind('agents');
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

  function carrierMenu(anchor: HTMLElement) {
    const held = carrier, open = store.openThread;
    if (!held || !open) return;
    const rect = anchor.getBoundingClientRect();
    contextMenu.show({ x: rect.left, y: rect.bottom }, [
      { id: 'open', label: fill(strings.agents.openAgent, { name: held.agent.name }) },
      ...(store.owner ? [{ id: 'back', label: strings.agents.takeBack }] : [])
    ], id => { if (id === 'open') store.showAgents(held.agent.id); else void entrust(store, open.id, null); }, anchor);
  }
  /** The agent this thread was entrusted to, if any. */
  let carrier = $derived(thread ? agentDirectory(store).entrustmentOf(thread.id) : null);
  /** A subagent's header starts with the conversation that started it: "parent / subagent". */
  let parentTitle = $derived(thread?.parentThreadId ? store.threads.find(entry => entry.id === thread!.parentThreadId)?.title ?? strings.delegation.parent : null);
  /** The agent the owner entrusted this thread's project to, when the thread itself is not entrusted. */
  let resident = $derived(thread ? residentOfThread(store, thread) : null);
</script>

<div class="thread-header" data-testid="thread-header" data-status={thread?.status}>
      {#if thread}
        {#if thread.parentThreadId}
          {@const parentId = thread.parentThreadId}
          <button type="button" class="ghost crumb" data-testid="delegation-back-parent" data-preload-thread={parentId} title={strings.delegation.parent} onclick={() => void store.open(parentId)}>
            <span class="ui-label">{parentTitle}</span>
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
          <!-- A small chevron exposes thread actions; on phones it also holds the title. -->
          <span class="title-menu">
            <Menu items={mobile.current ? phoneItems : desktopItems} onpick={titleAction} label={strings.sidebar.threadMenu} placement="bottom" variant="text" testid="thread-menu-trigger">
              <span class="title-lines"><span class="title-text ui-label">{thread.title}</span>{#if place || mobile.current}<span class="title-place ui-label" data-testid="thread-place">{#if mobile.current && (carrier ?? resident)}{@const bot = carrier?.agent ?? resident!}<span class="place-bot" data-testid="thread-place-bot" title={carrier ? fill(strings.agents.entrustedTo, { name: bot.name }) : fill(strings.resident.lookedAfterBy, { name: bot.name })}><AgentAvatar kind="profile" id={bot.id} name={bot.name} avatar={bot.avatar} size={16} /></span>{/if}{#if mobile.current}<span class="place-project">{placeProject}</span>{#if placeBranch}<span class="place-branch">{placeProject ? ` · ${placeBranch}` : placeBranch}</span>{/if}<span class="place-pr"><ThreadPullRequest owner={store} {thread} text separated={!!place} bind:current={pullRequest} /></span>{:else}<span class="place-text">{place}</span>{/if}</span>{/if}</span><ChevronDown size={14} />
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
      {:else}
        <span class="draft-mark"></span>
        <span class="title draft" data-testid="thread-title"><span class="ui-label">{strings.sidebar.draft}</span></span>
      {/if}

      <span class="spacer"></span>

      <!-- Incognito is chosen before the first send, in the drafts only, once there is an AI to send to. -->
      {#if !thread && store.draftInDrafts && !firstRunSteps(store).active}
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

      {#if thread && !thread.teamId && !thread.councilId}
        <!-- Where the thread works and who looks after it, in one neutral pill:
             the branch, its PR, then the real avatar of the agent it is
             entrusted to or of the one looking after its project. A phone keeps
             the avatar alone: the branch and the PR are under its title. -->
        <span class="context-pill" data-testid="thread-context">
          {#if thread.branch && work.shows('header.branch')}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="path branch mono" title="{thread.branch}: {strings.thread.branchHint}: {thread.cwd}" data-testid="thread-branch" oncontextmenu={(event) => controlMenu(event, store, 'header.branch')}>
              <GitBranch size={13} strokeWidth={1.75} />
              <span class="branch-name ui-label">{thread.branch}</span>
            </span>
          {/if}
          {#if !mobile.current}<span class="pr"><ThreadPullRequest owner={store} {thread} /></span>{/if}
          {#if (thread.pullRequestWatches?.length ?? 0) > 0}
            {@const watches = thread.pullRequestWatches ?? []}
            <!-- What a watch saw and its Stop, on a phone too: a paired phone has no Tasks panel. -->
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
          {#if carrier}
            <!-- The agent this thread was entrusted to: its menu opens the agent or takes the thread back. -->
            <button type="button" class="ghost avatar entrusted" title={fill(strings.agents.entrustedTo, { name: carrier.agent.name })}
              aria-label={fill(strings.agents.entrustedTo, { name: carrier.agent.name })} data-testid="thread-entrusted-chip"
              onclick={(event) => carrierMenu(event.currentTarget)}>
              <AgentAvatar kind="profile" id={carrier.agent.id} name={carrier.agent.name} avatar={carrier.agent.avatar} size={mobile.current ? 24 : 20} />
            </button>
          {/if}
          {#if resident}
            <!-- The agent that looks after this thread's project: a click opens its conversation. -->
            <button type="button" class="ghost avatar resident" title={fill(strings.resident.lookedAfterBy, { name: resident.name })}
              aria-label={fill(strings.resident.lookedAfterBy, { name: resident.name })} data-testid="thread-resident-chip" data-agent-id={resident.id}
              onclick={() => openResident(store, resident!.id)}>
              <AgentAvatar kind="profile" id={resident.id} name={resident.name} avatar={resident.avatar} size={mobile.current ? 24 : 20} />
            </button>
          {/if}
        </span>
      {/if}
      <!-- A paired device opens the panel too: the Agents and Workflows surfaces are
           its to follow, and the panel's menu offers only what available() allows.
           A team's chat has no title menu: a phone keeps this button, its one way to the panel. -->
      {#if thread}
        <!-- The one way to the panel, on a phone too: its strip holds the browser,
             the terminal and the board. -->
        <!-- A click opens or shuts the panel; the chevron, a right click or a long
             press lists every surface and drawer by name, so Terminal and Board
             open with the panel shut. -->
        <span class="panel-split">
          <button
            type="button"
            class="ghost icon panel-toggle"
            class:on={store.panelOpen}
            title={`${strings.thread.panelHint}${store.keyHint('panel')}`}
            aria-label={strings.thread.panelHint}
            aria-pressed={store.panelOpen}
            data-testid="panel-toggle"
            onclick={() => store.togglePanel()}
            oncontextmenu={(event) => contextMenu.open(event, launcher, (id) => pickLauncher(store, id))}
            use:longPress
          >
            <PanelRight size={16} strokeWidth={1.75} />
          </button>
          <span class="panel-launch">
            <Menu items={launcher} onpick={(id) => pickLauncher(store, id)} label={strings.rightPanel.launcherMenu} placement="bottom" align="end" variant="ghost" testid="panel-list">
              <ChevronDown size={13} strokeWidth={1.75} />
            </Menu>
          </span>
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
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--color-foreground);
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
  }

  .title > .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title.team { gap: 6px; margin-left: 0; }
  .title.team > :global(svg) { flex: none; color: var(--color-muted-foreground); }

  .title.draft {
    color: var(--color-muted-foreground);
    font-weight: 500;
  }

  /* The field's 1 px border and 10 px padding stand left of its text, so the text starts where the title's did. */
  .rename {
    height: var(--control);
    width: min(420px, 50%);
    margin-left: -11px;
    font-weight: 600;
  }

  .draft-mark {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px dashed var(--color-muted-foreground);
    flex: none;
  }

  .spacer {
    flex: 1;
  }


  .path {
    flex: 0 1 auto;
    min-width: 0;
    max-width: min(240px, 35%);
    font-size: var(--text-sm);
  }
  .panel-toggle { flex: none; }
  /* The toggle and its list read as one control: the chevron hugs the button. */
  .panel-split { display: inline-flex; align-items: center; flex: none; gap: 0; }
  .panel-launch :global(.trigger.ghost) { width: 18px; height: var(--control); margin-left: -2px; }

  /* One neutral pill: the branch, its PR and the agent's face, no colour of its own. */
  .context-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 0 1 auto;
    min-width: 0;
    max-width: min(420px, 45%);
    height: 28px;
    padding: 0 4px 0 10px;
    border-radius: 999px;
    background: var(--color-surface-2);
    box-shadow: inset 0 0 0 1px var(--color-border);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }
  /* Nothing to hold (no branch, PR, watch or agent): no pill at all. */
  .context-pill:not(:has(.path, .avatar, .watch-chip, .pr a)) { display: none; }
  .context-pill .path { display: inline-flex; align-items: center; gap: 5px; max-width: none; }
  .context-pill .pr { display: inline-flex; flex: none; }
  .context-pill .pr:not(:has(a)) { display: none; }
  .avatar { display: inline-grid; place-items: center; flex: none; width: 24px; height: 24px; min-height: 0; padding: 0; border-radius: 999px; }
  .context-pill > :last-child:not(.avatar) { margin-right: 6px; }
  .branch-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .branch :global(svg) { flex: none; }
  .watch-chip { flex: none; display: inline-flex; color: var(--color-accent); }
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
    color: var(--color-accent);
  }
  .pending :global(svg) { flex: none; }
  .pending-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .title { min-width: 0; }
  .title-menu { display: flex; flex: none; }
  .title-text, .title-lines { display: none; }
  .place-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .place-pr { flex: none; white-space: pre; }
  @media (max-width: 720px) {
    /* The title is what tells one conversation from another: the buttons give
       up their words for it, and keep a finger-sized square. */
    .thread-header { gap: 4px; }
    .path { display: none; }
    .pending { flex: none; min-width: var(--touch-target); justify-content: center; }
    .pending-text { display: none; }
    .trace { padding: 0; min-width: var(--touch-target); justify-content: center; }
    .trace .label, .incognito .label, .context-chip :global(.label) { display: none; }
    .context-chip :global(.chip) { min-width: var(--touch-target); justify-content: center; }
    /* The row keeps back, the title and the panel button: the bot's face moved
       into the subtitle and its actions into the title's menu; the branch and the
       PR are under the title. */
    .context-pill { display: none; }
    .panel-toggle { width: var(--touch-target); height: var(--touch-target); }
    /* A finger has the long press, and the panel's own header lists every surface. */
    .panel-launch { display: none; }
    .rename { width: 100%; }
    /* The thread's title button gives way to its menu; a draft's label and a team's name have no menu and stay. */
    .title:not(.draft):not(.team) { display: none; }
    .title.draft, .title.team { max-width: none; }
    .draft-mark { margin: 0 4px 0 6px; }
    /* The title takes every pixel the buttons leave: its own line, the place under it. */
    .title-menu { display: flex; min-width: 0; flex: 1 1 auto; margin-left: -6px; }
    .title-menu :global(.menu) { min-width: 0; max-width: 100%; }
    .title-menu :global(.trigger) { min-width: 0; max-width: 100%; min-height: var(--touch-target); font-weight: 600; color: var(--color-foreground); }
    .title-lines { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 0; line-height: 1.25; }
    /* Two lines stacked: a label's ascender room and its trim to the capitals would pull the second over the first. */
    .title-lines > .ui-label { margin-block: 0; padding-block: 0; text-box: normal; }
    /* A long title wraps to a second line before its ellipsis, so it reads whole more often than cut mid-word; the
       header grows by that one line only for such a title, and the place drops below it. `pretty` keeps the second
       line from ending on one word ("Add rate limiting to the / public API"). */
    .title-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; max-width: 100%; min-width: 0; overflow: hidden; white-space: normal; overflow-wrap: anywhere; text-wrap: pretty; text-align: left; font-size: 17px; font-weight: 600; }
    /* The place gives way first: the PR number after it always shows. Nothing to say, no line. */
    .title-place:not(:has(.place-text:not(:empty), .place-project:not(:empty), .place-branch, .place-bot, .place-pr:not(:empty))) { display: none; }
    .title-place { display: flex; align-items: center; max-width: 100%; min-width: 0; white-space: nowrap; font-size: var(--text-xs); font-weight: 400; color: var(--color-muted-foreground); }
    .place-bot { display: inline-grid; flex: none; margin-right: 5px; }
    /* The branch is cut before the project, which keeps its name as long as it can. */
    /* `pre` keeps the space before the branch's dot, which a flex item would drop. */
    .place-project, .place-branch { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
    .place-project { flex: 0 1 auto; }
    .place-branch { flex: 0 1000 auto; }
    .title-menu :global(.trigger svg) { flex: none; color: var(--color-muted-foreground); }
    .crumb { min-height: var(--touch-target); }
    .crumb-sep { margin: 0; }
    .crumb-sep ~ .title-menu { margin-left: 0; }
  }
</style>
