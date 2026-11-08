<script lang="ts">
  import { Activity, Contact, MessageSquare, Plus, Settings } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { count } from '../lib/format';
  import { machineName, workspace, type Machine } from '../lib/workspace.svelte';
  import { experimentOn } from '../lib/experiments.svelte';
  import { agentDirectory, followAgentDirectories } from '../lib/agent-directory.svelte';
  import { agentRows, waitingOn, type AgentRowData } from '../lib/agents.svelte';
  import { watchTeams, type TeamRow } from '../lib/teams.svelte';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { projectView } from '../lib/project-view.svelte';
  import { botEngine, newBot, newTeam } from '../lib/agents-view.svelte';
  import { separator } from '../lib/menu';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { dragWindow } from '../lib/window-drag';
  import { isMac } from '../lib/keybindings';
  import { railBotState, threadsNeedingYou, type RailBotState } from '../lib/app-rail';
  import { inbox } from '../lib/inbox.svelte';
  import { followActivityReturn } from '../lib/activity-return.svelte';
  import AgentAvatar from './agents/AgentAvatar.svelte';
  import { avatarLit } from '../lib/avatar-lit';
  import MachineStatus from './MachineStatus.svelte';
  import WhipButton from './WhipButton.svelte';
  import FailMark from './FailMark.svelte';
  import Deferred, { parts } from './Deferred.svelte';

  /**
   * The column down the window's left edge, on a desktop, the same in every
   * view: where to be (the threads, Activity with what asks), then one picture
   * per bot of every machine and the teams, then the machines when there is
   * more than one, and Settings. One edge pip marks the open place; a bot's
   * news is a badge on its picture. Contacts is the Bots column's other side
   * (agents/SideHead.svelte), its own place only with Bots off; the limits are a line at the foot of the list column
   * (QuotaLine.svelte). It stands on the window's chrome from top to bottom;
   * a phone keeps its own navigation and never draws it.
   */
  let { store }: { store: Store } = $props();

  const machines = $derived(workspace.machinesOr(store));
  const stores = $derived(machines.map(machine => machine.store));
  /** A bot's name card says its machine once there are two. */
  const several = $derived(machines.length > 1);
  const botsOn = $derived(experimentOn('resident-agents'));
  const teamsOn = $derived(botsOn && experimentOn('teams'));
  const contactsOn = $derived(contactsShown(store));
  const macShell = window.__TAURI_INTERNALS__ !== undefined && isMac();

  // Every machine's bots stay read while the rail is drawn, so their pictures say how each one stands.
  followAgentDirectories(() => stores, () => botsOn);
  // Acting from Activity opens a thread; this rail lives as long as the desktop frame, so it walks the way back.
  followActivityReturn();
  const watchedTeams = watchTeams(() => teamsOn ? machines : []);

  /** Pinned bots first, then in the order they were made: a picture keeps its place as its bot talks. */
  const bots = $derived(botsOn ? machines
    .flatMap(machine => agentRows(agentDirectory(machine.store).snapshot).map(row => ({ machine, row })))
    .sort((a, b) => Number(b.row.profile.pinned === true) - Number(a.row.profile.pinned === true) || a.row.profile.createdAt - b.row.profile.createdAt) : []);
  const teams = $derived(teamsOn ? watchedTeams() : []);
  /** What Activity holds for the user: the threads waiting on them and what contacts ask. */
  const waiting = $derived(threadsNeedingYou(stores) + inbox.contacts);
  const waitingLabel = $derived(waiting === 1 ? strings.app.rail.waitingOne : fill(strings.app.rail.waitingMany, { count: String(waiting) }));

  /** The bot whose conversation the Bots page shows, on the window's machine. */
  const openBot = $derived.by(() => {
    const thread = store.openThread;
    if (store.page !== 'agents' || !thread) return null;
    const directory = agentDirectory(store);
    return directory.agentOfThread(thread.id)?.id ?? directory.ownerOf(thread)?.id ?? null;
  });
  const openTeam = $derived(store.page === 'agents' ? store.openThread?.teamId ?? null : null);
  const onList = $derived(store.page === 'chat' || store.page === 'home');
  // The Contacts page is the Bots column's other side, not the threads: neither of these is open there.
  const onThreads = $derived(store.page === 'chat' && !inbox.open);
  const onActivity = $derived(store.page === 'chat' && inbox.open);
  /** With Bots off there is no Bots column to switch: Contacts keeps its own place where the bots stand. */
  const contactsAlone = $derived(contactsOn && !botsOn);
  const onContacts = $derived(store.page === 'home');

  type Bot = { machine: Machine; row: AgentRowData };
  function stateOf({ machine, row }: Bot): RailBotState {
    const threadId = row.status?.threadId;
    const thread = threadId ? machine.store.threads.find(entry => entry.id === threadId) ?? null : null;
    const state = railBotState(row.profile, row.status, thread, waitingOn(machine.store, threadId) !== null);
    // A queued turn is work on its way: the picture draws it as work.
    return state === 'queued' ? 'working' : state;
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

  /** The thread list, or the Bots page or its Contacts side left for it. */
  function showThreads() {
    inbox.open = false;
    if (store.page !== 'chat') store.showChat();
    store.sidebarCollapsed = false;
  }
  /** Activity takes the main card, as the phone's tab takes the screen: the open thread steps back to a draft, its panels with it. */
  function showActivity() {
    inbox.open = true;
    // The Contacts page holds the main card: Activity takes it back.
    if (store.page === 'home') store.showChat();
    if (!onList || store.openThread) store.startDraft(undefined, { refresh: false });
    store.sidebarCollapsed = false;
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

  /** Settings' shortcut, from the keybindings table: its name card shows it and the button's description reads it. */
  const settingsKey = $derived(store.keyLabel('settings'));

  let ContactRequestNotice = $state<typeof import('./home/ContactRequestNotice.svelte').default>();
  $effect(() => {
    if (!contactsOn || ContactRequestNotice) return;
    void import('./home/ContactRequestNotice.svelte').then(module => { ContactRequestNotice = module.default; }).catch(() => {});
  });
</script>

<!-- Its name beside a rail button under the pointer or the keyboard, and its key when it has one: the button's
     own accessible name already says it, so the label is drawn for the eye alone. -->
{#snippet railName(label: string, key: string | null = null, note: string | null = null, keyId: string | undefined = undefined)}
  <span class="rail-name" aria-hidden="true"><span class="ui-label">{label}</span>{#if note}<span class="ui-label note">{note}</span>{/if}{#if key}<span class="kbd" id={keyId}>{key}</span>{/if}</span>
{/snippet}
{#snippet statusName(label: string, note: string | null)}{@render railName(label, null, note)}{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="app-rail" class:mac={macShell} aria-label={strings.app.rail.label} data-testid="app-rail" onmousedown={dragWindow}>
  <div class="slot" class:selected={onThreads}>
    <span class="pip" aria-hidden="true"></span>
    <button type="button" class="rail-button" class:on={onThreads} aria-current={onThreads ? 'page' : undefined}
      aria-label={strings.sidebar.threads}
      data-testid="view-threads" onclick={showThreads}>
      <MessageSquare size={19} strokeWidth={1.75} />
    </button>
    {@render railName(strings.sidebar.threads)}
  </div>
  <div class="slot" class:selected={onActivity}>
    <span class="pip" aria-hidden="true"></span>
    <button type="button" class="rail-button" class:on={onActivity} aria-current={onActivity ? 'page' : undefined}
      aria-label={waiting ? `${strings.mobile.activity}, ${waitingLabel}` : strings.mobile.activity}
      data-testid="nav-activity" onclick={showActivity}>
      <Activity size={19} strokeWidth={1.75} />
      {#if waiting}<span class="count" data-testid="rail-activity-waiting">{waiting > 99 ? '99+' : count(waiting)}</span>{/if}
    </button>
    {@render railName(strings.mobile.activity, null, waiting ? waitingLabel : null)}
  </div>
  <!-- What contacts ask arrives as a toast; Activity lists it, the Bots list's Contacts side holds the rest. -->
  {#if contactsOn && ContactRequestNotice}<ContactRequestNotice {store} />{/if}

  {#if botsOn}
    <span class="separator" aria-hidden="true"></span>
    <div class="bots" role="list" aria-label={strings.app.rail.bots}>
      {#each bots as bot (`${bot.machine.id}:${bot.row.profile.id}`)}
        {@const state = stateOf(bot)}
        {@const selected = bot.machine.store === store && openBot === bot.row.profile.id}
        {@const unread = (bot.row.status?.unread ?? 0) > 0}
        <div class="slot" class:selected role="listitem">
          <span class="pip" aria-hidden="true"></span>
          <button type="button" class="bot" class:dim={state === 'paused'} aria-label={unread && !selected ? `${labelOf(bot.row.profile.name, state)}, ${strings.app.rail.unread}` : labelOf(bot.row.profile.name, state)}
            aria-current={selected ? 'page' : undefined} data-testid="rail-bot" data-agent-id={bot.row.profile.id} data-state={state}
            onclick={() => workspace.showAgents(bot.machine.store, bot.row.profile.id)}>
            <AgentAvatar kind="profile" id={bot.row.profile.id} name={bot.row.profile.name} avatar={bot.row.profile.avatar} size={44} squircle={selected}
              lit={avatarLit({ open: selected, attention: state === 'waiting', failed: state === 'failed', unread })} />
            <!-- One overlay, in one slot: the user's turn first, then a failure, work, news. A count is Activity's alone. -->
            {#if state === 'waiting'}<span class="badge" aria-hidden="true"><span class="needs"></span></span>
            {:else if state === 'failed'}<span class="badge" aria-hidden="true"><FailMark /></span>
            {:else if state === 'working'}<span class="badge work" aria-hidden="true"><svg viewBox="0 0 14 14"><circle class="track" cx="7" cy="7" r="5" /></svg></span>
            {:else if unread && !selected}<span class="badge" data-testid="rail-bot-unread" aria-hidden="true"><span class="news"></span></span>{/if}
          </button>
          {@render railName(bot.row.profile.name, null, several ? machineName(bot.machine) : null)}
        </div>
      {/each}
      {#each teams as row (`${row.machine.id}:${row.team.id}`)}
        {@const selected = row.machine.store === store && openTeam === row.team.id}
        {@const news = !!row.chat?.unread && !selected}
        <div class="slot" class:selected role="listitem">
          <span class="pip" aria-hidden="true"></span>
          <button type="button" class="bot team" aria-label={news ? `${row.team.name}, ${strings.app.rail.unread}` : row.team.name} aria-current={selected ? 'page' : undefined}
            data-testid="rail-team" data-team-id={row.team.id} onclick={() => openTeamChat(row)}>
            <AgentAvatar kind="team" id={row.team.id} name={row.team.name} members={pictures(row)} size={44} squircle lit={avatarLit({ open: selected, unread: news })} />
            {#if news}<span class="badge" aria-hidden="true"><span class="news"></span></span>{/if}
          </button>
          {@render railName(row.team.name)}
        </div>
      {/each}
    </div>
    <div class="slot">
      <button type="button" class="rail-button add" aria-label={strings.app.rail.add} aria-haspopup="menu"
        data-testid="rail-add" onclick={(event) => addMenu(event.currentTarget)}><Plus size={19} strokeWidth={1.75} /></button>
      {@render railName(strings.app.rail.add)}
    </div>
  {/if}

  {#if contactsAlone}
    <span class="separator" aria-hidden="true"></span>
    <div class="slot" class:selected={onContacts}>
      <span class="pip" aria-hidden="true"></span>
      <button type="button" class="rail-button" class:on={onContacts} aria-current={onContacts ? 'page' : undefined} aria-label={strings.contacts.heading}
        data-testid="rail-contacts" data-preload-view="home" onclick={() => store.showHome()}><Contact size={19} strokeWidth={1.75} /></button>
      {@render railName(strings.contacts.heading)}
    </div>
  {/if}

  <span class="grow"></span>

  <!-- The machines, once there are two or one is in trouble; the limits are the list column's foot. -->
  <div class="foot">
    <!-- Lit like the buttons above while it filters the list or its menu is open. -->
    <div class="slot status" class:selected={machineFilter.shown(machines) !== null}>
      <span class="pip" aria-hidden="true"></span>
      <MachineStatus {store} filter={machineFilter.shown(machines)} onfilter={pickMachine} card={statusName} />
    </div>
    <Deferred part={parts.UpdatesNotice} quiet>{#snippet children(UpdatesNotice)}<UpdatesNotice />{/snippet}</Deferred>
    {#if experimentOn('whip')}<WhipButton />{/if}
    <div class="slot" class:selected={store.page === 'settings'}>
      <span class="pip" aria-hidden="true"></span>
      <button type="button" class="ghost icon" class:on={store.page === 'settings'} aria-current={store.page === 'settings' ? 'page' : undefined}
        aria-label={strings.sidebar.settings} aria-describedby={settingsKey ? 'rail-settings-key' : undefined}
        data-testid="nav-settings" data-preload-view="settings" onclick={() => store.showSettings()}><Settings size={19} strokeWidth={1.75} /></button>
      {@render railName(strings.sidebar.settings, settingsKey, null, 'rail-settings-key')}
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
  /* Grey at rest, lit when open, under the pointer or with news: one rule for every bot picture (lib/avatar-lit.ts). */
  .bot.dim :global(.agent-avatar) { opacity: 0.55; }
  .bot:active:not(:disabled) { transform: translateY(1px); }
  .team :global(.agent-avatar) { background: var(--color-surface-3); }

  /* The name card right of the rail, as a menu's surface: it waits a beat under the pointer, so a sweep down the
     rail does not flash every name, and shows at once for the keyboard. */
  /* The card opens past the list column, over the main card's edge: never over a row's words. `--bar-left` is the
     list's width and gap (App.svelte), the frame gap alone while the list is folded. */
  .rail-name {
    position: absolute;
    left: calc(100% + var(--bar-left, 0px) + 4px);
    top: 50%;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 9px;
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-sm);
    background: var(--overlay-surface);
    box-shadow: var(--shadow-overlay);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform: translate(-4px, -50%);
    transition: opacity var(--dur-1) var(--ease-out-quint), transform var(--dur-1) var(--ease-out-quint);
  }
  .rail-name .note { color: var(--color-muted-foreground); font-weight: 400; }
  /* Descendants: the machines button and its card sit inside MachineStatus. An open menu keeps its card away. */
  .slot:hover .rail-name { opacity: 1; transform: translate(0, -50%); transition-delay: 400ms; }
  .slot:has(:global(:focus-visible)) .rail-name { opacity: 1; transform: translate(0, -50%); }
  .slot:has(:global([aria-expanded='true'])) .rail-name { opacity: 0; transition-delay: 0ms; }
  .separator { flex: none; width: 28px; height: 1px; background: var(--color-edge); }
  .bots { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; min-height: 0; }

  /* Activity's count, bottom right, ringed in the chrome so it reads cut out; two digits fit inside the button's corner. */
  .count {
    position: absolute;
    right: -5px;
    bottom: -4px;
    min-width: 16px;
    height: 16px;
    box-sizing: border-box;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--color-live);
    color: var(--color-accent-ink);
    box-shadow: 0 0 0 2px var(--color-frame);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  /* A bot's or a team's one overlay, bottom right of its picture, cut out of the chrome: the amber dot for its turn,
     the failure's "!", the list rows' still accent arc for work (the open thread keeps the one live spinner), a full
     ink dot for news. */
  .badge {
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
  .needs, .news { width: 10px; height: 10px; border-radius: 50%; background: var(--color-live); }
  .news { background: var(--color-foreground); }
  .work svg { width: 14px; height: 14px; overflow: visible; }
  .work circle { fill: none; stroke-width: 2; }
  .work .track { stroke: var(--color-accent); stroke-dasharray: 23.6 31.4; transform: rotate(-45deg); transform-origin: 7px 7px; }

  .foot { display: flex; flex-direction: column; align-items: center; gap: 4px; align-self: stretch; }
  /* Settings marks itself selected like the buttons above, but its hover stays quiet like its neighbours. */
  .foot .slot:not(.selected):hover .pip { height: 0; }
  .foot :global(button.icon.on) { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); border-radius: var(--radius-rail); }
  .foot :global(button.icon) { width: var(--control-touch); height: var(--control-touch); color: var(--color-subtle); }
  .foot :global(button.icon:hover:not(:disabled)) { color: var(--color-foreground); }
  .foot :global(.machines .trigger) { width: var(--control-touch); height: var(--control-touch); }
  /* One machine says nothing: the wrapper stays, empty, for its connection state. */
  .foot :global(.machines:not(:has(.trigger))) { display: none; }
  .foot .status:not(:has(:global(.trigger))) { display: none; }
  .foot .status:has(:global(.trigger[aria-expanded='true'])) .pip { height: 36px; }
  .foot :global(.machines.filtered .trigger), .foot :global(.machines .trigger[aria-expanded='true']) { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); border-radius: var(--radius-rail); }
  /* A filter names its machine beside the button: the rail has no room, so the button alone says it, lit. */
  .foot :global(.machines .name) { display: none; }

  @media (max-width: 720px) {
    .app-rail { display: none; }
  }
</style>
