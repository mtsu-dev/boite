<script lang="ts">
  import { MessageSquare, Plus, Settings, Users } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { count } from '../lib/format';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import { experimentOn } from '../lib/experiments.svelte';
  import { agentDirectory, followAgentDirectories } from '../lib/agent-directory.svelte';
  import { agentRows, waitingOn, type AgentRowData } from '../lib/agents.svelte';
  import { watchTeams, type TeamRow } from '../lib/teams.svelte';
  import { contactsRail, contactsShown } from '../lib/contacts-rail.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { projectView } from '../lib/project-view.svelte';
  import { botEngine, newBot, newTeam } from '../lib/agents-view.svelte';
  import { separator } from '../lib/menu';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { work } from '../lib/work-prefs.svelte';
  import { controlMenu } from '../lib/controls';
  import { dragWindow } from '../lib/window-drag';
  import { isMac } from '../lib/keybindings';
  import { railBotState, threadsNeedingYou, type RailBotState } from '../lib/app-rail';
  import AgentAvatar from './agents/AgentAvatar.svelte';
  import MachineStatus from './MachineStatus.svelte';
  import LimitsGlance from './LimitsGlance.svelte';
  import WhipButton from './WhipButton.svelte';
  import Deferred, { parts } from './Deferred.svelte';

  /**
   * The column down the window's left edge, on a desktop: where to be (the
   * threads, the contacts, what asks), then one picture per bot of every
   * machine and the teams, then the machine, the limits and Settings. It
   * stands on the window's chrome from top to bottom; a phone keeps its own
   * navigation and never draws it.
   */
  let { store }: { store: Store } = $props();

  const machines = $derived(workspace.machinesOr(store));
  const stores = $derived(machines.map(machine => machine.store));
  const botsOn = $derived(experimentOn('resident-agents'));
  const teamsOn = $derived(botsOn && experimentOn('teams'));
  const contactsOn = $derived(contactsShown(store));
  const macShell = window.__TAURI_INTERNALS__ !== undefined && isMac();

  // Every machine's bots stay read while the rail is drawn, so their pictures say how each one stands.
  followAgentDirectories(() => stores, () => botsOn);
  const watchedTeams = watchTeams(() => teamsOn ? machines : []);

  /** Pinned bots first, then in the order they were made: a picture keeps its place as its bot talks. */
  const bots = $derived(botsOn ? machines
    .flatMap(machine => agentRows(agentDirectory(machine.store).snapshot).map(row => ({ machine, row })))
    .sort((a, b) => Number(b.row.profile.pinned === true) - Number(a.row.profile.pinned === true) || a.row.profile.createdAt - b.row.profile.createdAt) : []);
  const teams = $derived(teamsOn ? watchedTeams() : []);
  const waiting = $derived(threadsNeedingYou(stores));
  const waitingLabel = $derived(waiting === 1 ? strings.app.rail.waitingOne : fill(strings.app.rail.waitingMany, { count: String(waiting) }));

  /** The bot whose conversation the Bots page shows, on the window's machine. */
  const openBot = $derived.by(() => {
    const thread = store.openThread;
    if (store.page !== 'agents' || !thread) return null;
    const directory = agentDirectory(store);
    return directory.agentOfThread(thread.id)?.id ?? directory.ownerOf(thread)?.id ?? null;
  });
  const openTeam = $derived(store.page === 'agents' ? store.openThread?.teamId ?? null : null);
  const onThreads = $derived(store.page === 'chat' || store.page === 'home');

  type Bot = { machine: Machine; row: AgentRowData };
  function stateOf({ machine, row }: Bot): RailBotState {
    const threadId = row.status?.threadId;
    const thread = threadId ? machine.store.threads.find(entry => entry.id === threadId) ?? null : null;
    const state = railBotState(row.profile, row.status, thread, waitingOn(machine.store, threadId) !== null);
    // A queued turn is work on its way: the picture draws it as work.
    return state === 'queued' ? 'working' : state;
  }
  /** The questions and permissions its thread holds open: at least one while it waits. */
  function asksOf({ machine, row }: Bot): number {
    const threadId = row.status?.threadId;
    if (!threadId) return 1;
    const open = machine.store.pendingQuestions.filter(q => q.threadId === threadId).length + machine.store.pendingPermissions.filter(p => p.threadId === threadId).length;
    return Math.max(1, open);
  }
  function labelOf(name: string, state: RailBotState): string {
    if (state === 'waiting') return fill(strings.app.rail.botWaiting, { name });
    if (state === 'failed') return fill(strings.app.rail.botFailed, { name });
    if (state === 'working') return fill(strings.app.rail.botWorking, { name });
    if (state === 'paused') return fill(strings.app.rail.botPaused, { name });
    return name;
  }
  /** The members as pictures: the bot's own when its machine's bots are read, else the robot its id picks. */
  function pictures({ machine, team }: TeamRow) {
    const profiles = agentDirectory(machine.store).snapshot?.profiles ?? [];
    return team.members.map(member => profiles.find(profile => profile.id === member.botId) ?? { id: member.botId, name: member.name, avatar: '' });
  }

  /** The thread list, or the Bots page left for it. */
  function showThreads() {
    if (!onThreads) store.showChat();
  }
  /** The contacts column the title bar folded before: drawn beside the thread list, so it brings the list back first. */
  function showContacts() {
    if (!onThreads) {
      store.showChat();
      if (contactsRail.folded) contactsRail.toggle();
      return;
    }
    contactsRail.toggle();
  }
  function openTeamChat({ machine, team }: TeamRow) {
    workspace.showAgents(machine.store);
    void workspace.select(machine.store, team.threadId);
  }
  /** What the Bots page's head offers, from anywhere: the page owns the forms (agents-view.svelte.ts). */
  function addMenu(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    contextMenu.show({ x: rect.right + 8, y: rect.top }, [
      { id: 'bot', label: strings.agents.newAgent },
      ...(teamsOn && store.owner ? [{ id: 'team', label: strings.teamChat.newTeam }] : []),
      ...(store.owner ? [separator('sep-engine'), { id: 'engine', label: strings.agents.engineSettings }] : [])
    ], id => { if (id === 'bot') newBot(store); else if (id === 'team') newTeam(store); else botEngine(store); }, anchor);
  }
  function pickMachine(id: string | null) {
    const entries = machines.flatMap(machine => machine.store.projects.map(project => ({ machine, project })));
    const selected = projectView.selected(entries);
    if (id && selected && selected.machine.id !== id) projectView.pick('all');
    machineFilter.set(id);
  }

  let ContactRequestNotice = $state<typeof import('./home/ContactRequestNotice.svelte').default>();
  $effect(() => {
    if (!contactsOn || ContactRequestNotice) return;
    void import('./home/ContactRequestNotice.svelte').then(module => { ContactRequestNotice = module.default; }).catch(() => {});
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="app-rail" class:mac={macShell} aria-label={strings.app.rail.label} data-testid="app-rail" onmousedown={dragWindow}>
  <div class="slot" class:selected={onThreads}>
    <span class="pip" aria-hidden="true"></span>
    <button type="button" class="rail-button" class:on={onThreads} aria-current={onThreads ? 'page' : undefined}
      title={strings.sidebar.threads} aria-label={waiting ? `${strings.sidebar.threads}, ${waitingLabel}` : strings.sidebar.threads}
      data-testid="view-threads" onclick={showThreads}>
      <MessageSquare size={19} strokeWidth={1.75} />
      {#if waiting}<span class="count" data-testid="rail-threads-waiting" title={waitingLabel}>{count(waiting)}</span>{/if}
    </button>
  </div>
  {#if contactsOn}
    {@const open = onThreads && !contactsRail.folded}
    <div class="slot">
      <button type="button" class="rail-button" class:on={open}
        aria-label={contactsRail.folded ? strings.contacts.rail.show : strings.contacts.rail.hide}
        title={contactsRail.folded ? strings.contacts.rail.show : strings.contacts.rail.hide}
        aria-expanded={open} data-testid="contacts-toggle" onclick={showContacts}>
        <Users size={19} strokeWidth={1.75} />
        {#if contactsRail.folded && contactsRail.waiting}<span class="dot" data-testid="contacts-toggle-waiting"></span>{/if}
      </button>
    </div>
    {#if ContactRequestNotice}<div class="slot"><ContactRequestNotice {store} rail /></div>{/if}
  {/if}

  {#if botsOn}
    <span class="separator" aria-hidden="true"></span>
    <div class="bots" role="list" aria-label={strings.app.rail.bots}>
      {#each bots as bot (`${bot.machine.id}:${bot.row.profile.id}`)}
        {@const state = stateOf(bot)}
        {@const selected = bot.machine.store === store && openBot === bot.row.profile.id}
        {@const unread = (bot.row.status?.unread ?? 0) > 0}
        <div class="slot" class:selected class:unread={unread && !selected} role="listitem">
          <span class="pip" aria-hidden="true"></span>
          <button type="button" class="bot" class:dim={state === 'paused'} title={bot.row.profile.name} aria-label={labelOf(bot.row.profile.name, state)}
            aria-current={selected ? 'page' : undefined} data-testid="rail-bot" data-agent-id={bot.row.profile.id} data-state={state}
            onclick={() => workspace.showAgents(bot.machine.store, bot.row.profile.id)}>
            <AgentAvatar kind="profile" id={bot.row.profile.id} name={bot.row.profile.name} avatar={bot.row.profile.avatar} size={44} squircle={selected} />
            {#if state === 'waiting'}<span class="count">{count(asksOf(bot))}</span>
            {:else if state === 'failed'}<span class="count failed">!</span>
            {:else if state === 'working'}<span class="work" aria-hidden="true"><svg viewBox="0 0 14 14"><circle class="track" cx="7" cy="7" r="5" /><circle class="arc" cx="7" cy="7" r="5" pathLength="100" /></svg></span>{/if}
          </button>
        </div>
      {/each}
      {#each teams as row (`${row.machine.id}:${row.team.id}`)}
        {@const selected = row.machine.store === store && openTeam === row.team.id}
        <div class="slot" class:selected class:unread={!!row.chat?.unread && !selected} role="listitem">
          <span class="pip" aria-hidden="true"></span>
          <button type="button" class="bot team" title={row.team.name} aria-label={row.team.name} aria-current={selected ? 'page' : undefined}
            data-testid="rail-team" data-team-id={row.team.id} onclick={() => openTeamChat(row)}>
            <AgentAvatar kind="team" id={row.team.id} name={row.team.name} members={pictures(row)} size={44} squircle />
          </button>
        </div>
      {/each}
    </div>
    <div class="slot">
      <button type="button" class="rail-button add" title={strings.app.rail.add} aria-label={strings.app.rail.add} aria-haspopup="menu"
        data-testid="rail-add" onclick={(event) => addMenu(event.currentTarget)}><Plus size={19} strokeWidth={1.75} /></button>
    </div>
  {/if}

  <span class="grow"></span>

  <div class="foot">
    <MachineStatus {store} filter={machineFilter.shown(machines)} onfilter={pickMachine} />
    <Deferred part={parts.UpdatesNotice} quiet>{#snippet children(UpdatesNotice)}<UpdatesNotice />{/snippet}</Deferred>
    {#if work.shows('sidebar.limits')}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="control" oncontextmenu={(event) => controlMenu(event, store, 'sidebar.limits')}><LimitsGlance {store} side="right" /></span>
    {/if}
    {#if experimentOn('whip')}<WhipButton />{/if}
    <div class="slot" class:selected={store.page === 'settings'}>
      <span class="pip" aria-hidden="true"></span>
      <button type="button" class="ghost icon" class:on={store.page === 'settings'} aria-current={store.page === 'settings' ? 'page' : undefined}
        title={`${strings.sidebar.settings}${store.keyHint('settings')}`} aria-label={strings.sidebar.settings}
        data-testid="nav-settings" data-preload-view="settings" onclick={() => store.showSettings()}><Settings size={18} strokeWidth={1.75} /></button>
    </div>
  </div>
</nav>

<style>
  .app-rail {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 2;
    width: var(--app-rail);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 0 12px;
    background: var(--color-frame);
    user-select: none;
    -webkit-user-select: none;
  }
  /* macOS draws its traffic lights over the window's top left corner. */
  .app-rail.mac { padding-top: 40px; }
  .grow { flex: 1; min-height: 8px; }

  /* One place per button: its pip stands in the rail's left edge. */
  .slot { position: relative; display: grid; place-items: center; width: 100%; }
  .pip {
    position: absolute;
    left: 0;
    top: 50%;
    width: 4px;
    height: 0;
    border-radius: 0 var(--radius-full) var(--radius-full) 0;
    background: var(--color-foreground);
    transform: translateY(-50%);
    transition: height var(--dur-2) var(--ease-out-quint);
  }
  .slot.unread .pip { height: 8px; }
  .slot:hover .pip { height: 18px; }
  .slot.selected .pip { height: 36px; }

  .rail-button, .bot {
    position: relative;
    width: var(--rail-button);
    height: var(--rail-button);
    padding: 0;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-rail);
    color: var(--color-muted-foreground);
    box-shadow: none;
  }
  .rail-button { background: var(--color-surface-2); }
  .rail-button:hover:not(:disabled) { background: var(--color-surface-3); color: var(--color-foreground); }
  .rail-button.on { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
  .rail-button.add { background: transparent; box-shadow: inset 0 0 0 1px var(--color-edge); border-radius: var(--radius-full); }
  .rail-button.add:hover:not(:disabled) { background: var(--color-hover); }

  .bot { background: none; border-radius: var(--radius-full); }
  .bot:hover:not(:disabled) { background: none; }
  /* At rest a bot's picture is grey; the open one and the one under the pointer
     take their colours, so the rail stays quiet and the eye finds where it is. */
  .bot :global(.agent-avatar) { filter: grayscale(1) brightness(0.92) contrast(0.95); transition: filter var(--dur-2) var(--ease-out-quint); }
  .bot:hover :global(.agent-avatar), .bot:focus-visible :global(.agent-avatar), .selected .bot :global(.agent-avatar) { filter: none; }
  .bot.dim :global(.agent-avatar) { opacity: 0.55; }
  @media (prefers-reduced-motion: reduce) { .bot :global(.agent-avatar) { transition: none; } }
  :global(html[data-motion='reduced']) .bot :global(.agent-avatar) { transition: none; }
  .bot:active:not(:disabled) { transform: translateY(1px); }
  .team :global(.agent-avatar) { background: var(--color-surface-3); }

  .separator { flex: none; width: 28px; height: 1px; background: var(--color-edge); }
  .bots { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; min-height: 0; }

  /* Bottom right of a button: what asks, in the waiting colour, ringed in the chrome so it reads cut out. */
  .count {
    position: absolute;
    right: -4px;
    bottom: -3px;
    min-width: 18px;
    height: 18px;
    box-sizing: border-box;
    padding: 0 5px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--color-live);
    color: var(--color-accent-ink);
    box-shadow: 0 0 0 3px var(--color-frame);
    font-size: var(--text-xs);
    font-weight: 700;
    line-height: 1;
  }
  .count.failed { background: var(--color-danger); color: var(--color-on-danger); }
  .dot { position: absolute; right: 8px; top: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--color-live); box-shadow: 0 0 0 2px var(--color-surface-2); }
  /* At work: a small arc of the accent turning, the one moving mark in the rail. */
  .work {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--color-frame);
  }
  .work svg { width: 14px; height: 14px; overflow: visible; }
  .work circle { fill: none; stroke-width: 2; }
  .work .track { stroke: var(--color-edge); }
  .work .arc { stroke: var(--color-accent); stroke-linecap: round; stroke-dasharray: 30 70; transform-box: fill-box; transform-origin: center; animation: spin 1.2s steps(72) infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .work .arc { animation: none; } }
  :global(html[data-motion='reduced']) .work .arc { animation: none; }

  .foot { display: flex; flex-direction: column; align-items: center; gap: 4px; align-self: stretch; }
  /* Settings marks itself selected like the buttons above, but its hover stays quiet like its neighbours. */
  .foot .slot:not(.selected):hover .pip { height: 0; }
  .foot :global(button.icon.on) { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); border-radius: var(--radius-rail); }
  .control { display: contents; }
  .foot :global(button.icon) { width: var(--control-touch); height: var(--control-touch); color: var(--color-subtle); }
  .foot :global(button.icon:hover:not(:disabled)) { color: var(--color-foreground); }
  .foot :global(.machines .trigger) { width: var(--control-touch); height: var(--control-touch); }
  /* One machine says nothing: the wrapper stays, empty, for its connection state. */
  .foot :global(.machines:not(:has(.trigger))) { display: none; }
  /* A filter names its machine beside the button: the rail has no room, so the button alone says it, lit. */
  .foot :global(.machines .name) { display: none; }

  @media (max-width: 720px) {
    .app-rail { display: none; }
  }
</style>
