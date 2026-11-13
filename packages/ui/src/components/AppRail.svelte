<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { Contact, Inbox, MessageSquare, Plus, Settings } from '@lucide/svelte';
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
  import { railBotState, threadsNeedingYou, type RailBotState } from '../lib/app-rail';
  import { inbox } from '../lib/inbox.svelte';
  import { followActivityReturn } from '../lib/activity-return.svelte';
  import AgentAvatar from './agents/AgentAvatar.svelte';
  import { avatarLit } from '../lib/avatar-lit';
  import MachineStatus, { type MachineLine } from './MachineStatus.svelte';
  import { whipEntry } from '../lib/whip-entry.svelte';
  import FailMark from './FailMark.svelte';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import { QuotaReorder } from '../lib/quota-reorder.svelte';
  import { railOrder } from '../lib/rail-order.svelte';

  /**
   * The column down the window's left edge, on a desktop, the same in every
   * view: where to be (the threads, Activity with what asks), then one picture
   * per team and per bot of every machine, in the order the user dragged them, then the machines when there is
   * more than one, and Settings. One edge pip marks the open place; a bot's
   * news is a badge on its picture. Contacts is the Bots column's other side
   * (agents/SideHead.svelte), its own place only with Bots off; the limits are a line at the foot of the list column
   * (QuotaLine.svelte). It stands on the window's chrome from top to bottom;
   * a phone keeps its own navigation and never draws it.
   */
  let { store }: { store: Store } = $props();
  /** Below 720 pixels the rail is not drawn: the thread list's drawer holds the update button (RailFrame.svelte), one card for the window. */
  const narrow = new MediaQuery('(max-width: 720px)');

  const machines = $derived(workspace.machinesOr(store));
  const stores = $derived(machines.map(machine => machine.store));
  /** A bot's name card says its machine once there are two. */
  const several = $derived(machines.length > 1);
  const botsOn = $derived(experimentOn('resident-agents'));
  const teamsOn = $derived(botsOn && experimentOn('teams'));
  const contactsOn = $derived(contactsShown(store));

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
  /**
   * Bots and teams in one list the user orders by dragging a picture up or down (or the arrow keys, Home and End on a focused
   * one): a press that does not move 6 px stays a click. Untouched, the teams lead, then the bots as sorted above.
   */
  const reorder = new QuotaReorder({
    order: () => railOrder.current,
    onreorder: () => async (order: string[]) => { railOrder.save(order); return true; },
    item: '.bots > .slot', attribute: 'railId', grip: '.bot', scroller: (root) => root
  });
  type RailEntry = { key: string } & ({ kind: 'team'; team: TeamRow } | { kind: 'bot'; bot: Bot });
  const entries = $derived(reorder.sort<RailEntry>([
    ...teams.map(team => ({ key: `${team.machine.id}:team:${team.team.id}`, kind: 'team' as const, team })),
    ...bots.map(bot => ({ key: `${bot.machine.id}:bot:${bot.row.profile.id}`, kind: 'bot' as const, bot }))
  ], entry => entry.key));
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

  /**
   * The bots scroll when there are more than the rail holds, and a scroller clips what passes its edge: their name
   * cards stand fixed in the window instead, placed against their slot when the pointer, the keyboard or a scroll
   * brings one up.
   */
  function placeName(slot: Element | null) {
    const name = slot?.querySelector<HTMLElement>(':scope > .rail-name');
    if (!slot || !name) return;
    const box = slot.getBoundingClientRect();
    name.style.setProperty('--name-x', `${box.right + 4}px`);
    name.style.setProperty('--name-y', `${box.top + box.height / 2}px`);
  }
  const slotOf = (event: Event) => (event.target as Element | null)?.closest('.bots > .slot') ?? null;
  function placeShownNames(event: Event) {
    for (const slot of (event.currentTarget as HTMLElement).querySelectorAll(':scope > .slot:hover, :scope > .slot:focus-within')) placeName(slot);
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
<!-- The machines' card: its name and what a click does ("Machines · click to filter"), the trouble if any, then each
     machine on a line of its own with the state dot the filter's menu shows. -->
{#snippet machinesName(label: string, hint: string | null, note: string | null, lines: MachineLine[])}
  <span class="rail-name machines-name" aria-hidden="true" data-testid="machine-status-card">
    <span class="title"><span class="ui-label">{label}</span>{#if hint}<span class="ui-label note">· {hint}</span>{/if}</span>{#if note}<span class="ui-label note">{note}</span>{/if}
    {#each lines as line (line.id)}<span class="machine-line" data-tone={line.tone}><span class="state-dot" aria-hidden="true"></span><span class="ui-label">{line.name}</span><span class="ui-label note">{line.state}</span></span>{/each}
  </span>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="app-rail" aria-label={strings.app.rail.label} data-testid="app-rail" onmousedown={dragWindow}>
  <!-- The rail's card, under its buttons: rounded and edged like the chat card (app.css `.framed`), its top level
       with the chat card's, so the band above stays the window's to drag (and macOS's lights). -->
  <span class="rail-card framed" aria-hidden="true"></span>
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
      <Inbox size={19} strokeWidth={1.75} />
      {#if waiting}<span class="count" data-testid="rail-activity-waiting">{waiting > 99 ? '99+' : count(waiting)}</span>{/if}
    </button>
    {@render railName(strings.mobile.activity, null, waiting ? waitingLabel : null)}
  </div>
  <!-- What contacts ask arrives as a toast; Activity lists it, the Bots list's Contacts side holds the rest. -->
  {#if contactsOn && ContactRequestNotice}<ContactRequestNotice {store} />{/if}

  {#if botsOn}
    <span class="separator" aria-hidden="true"></span>
    <div class="bots" class:reordering={reorder.dragging !== null} role="list" aria-label={strings.app.rail.bots} use:reorder.track onpointerover={(event) => placeName(slotOf(event))} onfocusin={(event) => placeName(slotOf(event))} onscroll={placeShownNames}>
      {#each entries as entry (entry.key)}
        {#if entry.kind === 'bot'}
          {@const bot = entry.bot}
          {@const state = stateOf(bot)}
          {@const selected = bot.machine.store === store && openBot === bot.row.profile.id}
          {@const unread = (bot.row.status?.unread ?? 0) > 0}
          <div class="slot" class:selected class:dragging={reorder.dragging === entry.key} role="listitem" data-rail-id={entry.key}>
            <span class="pip" aria-hidden="true"></span>
            <button type="button" class="bot" class:dim={state === 'paused'} aria-label={unread && !selected ? `${labelOf(bot.row.profile.name, state)}, ${strings.app.rail.unread}` : labelOf(bot.row.profile.name, state)}
              aria-current={selected ? 'page' : undefined} aria-keyshortcuts="ArrowUp ArrowDown Home End" data-testid="rail-bot" data-agent-id={bot.row.profile.id} data-state={state}
              onpointerdown={(event) => reorder.start(event, entry.key)} onkeydown={(event) => reorder.keyboard(event, entry.key)}
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
        {:else}
          {@const row = entry.team}
          {@const selected = row.machine.store === store && openTeam === row.team.id}
          {@const news = !!row.chat?.unread && !selected}
          <div class="slot" class:selected class:dragging={reorder.dragging === entry.key} role="listitem" data-rail-id={entry.key}>
            <span class="pip" aria-hidden="true"></span>
            <button type="button" class="bot team" aria-label={news ? `${row.team.name}, ${strings.app.rail.unread}` : row.team.name} aria-current={selected ? 'page' : undefined}
              aria-keyshortcuts="ArrowUp ArrowDown Home End" data-testid="rail-team" data-team-id={row.team.id}
              onpointerdown={(event) => reorder.start(event, entry.key)} onkeydown={(event) => reorder.keyboard(event, entry.key)}
              onclick={() => openTeamChat(row)}>
              <AgentAvatar kind="team" id={row.team.id} name={row.team.name} members={pictures(row)} size={44} squircle lit={avatarLit({ open: selected, unread: news })} />
              {#if news}<span class="badge" aria-hidden="true"><span class="news"></span></span>{/if}
            </button>
            {@render railName(row.team.name)}
          </div>
        {/if}
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
      <MachineStatus {store} filter={machineFilter.shown(machines)} onfilter={pickMachine} card={machinesName} />
    </div>
    <!-- Each with the same name card as every rail button; a slot with no button (nothing to update) takes no room. -->
    {#if !narrow.current}<div class="slot extra"><Deferred part={parts.UpdatesNotice} quiet>{#snippet children(UpdatesNotice)}<UpdatesNotice name={statusName} />{/snippet}</Deferred></div>{/if}
    {#if experimentOn('whip') && whipEntry.feature}{@const WhipButton = whipEntry.feature.WhipButton}<div class="slot extra"><WhipButton name={statusName} /></div>{/if}
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
    padding: calc(var(--titlebar) + 10px) 0 calc(var(--frame-gap) + 12px);
    user-select: none;
    -webkit-user-select: none;
    /* The card's own ground: the badges and counts are cut out of it. */
    --rail-ground: var(--color-background);
  }
  /* A card of the frame like the chat's, inset by the frame gap on the window's side and the list's, its top on
     the chat card's. Behind every button (z-index -1 in the rail's own stacking context). */
  .rail-card { position: absolute; inset: var(--titlebar) var(--frame-gap) var(--frame-gap); z-index: -1; pointer-events: none; }
  .grow { flex: 1; min-height: 8px; }

  /* One place per button: its pip stands in the rail's left edge. */
  .slot { position: relative; display: grid; place-items: center; width: 100%; }
  /* Inside the card's left edge, clear of a 44 px picture's left side (18 px in), so it never cuts one. */
  .pip {
    position: absolute;
    left: calc(var(--frame-gap) + 2px);
    top: 50%;
    width: 4px;
    height: 0;
    border-radius: var(--radius-full);
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
  /* Where you are is the one filled tile: the others stand bare on the card, and the pointer lights one a step
     under the open place's fill, so hover never reads as a second selection. */
  .rail-button { background: transparent; }
  .rail-button:hover:not(:disabled) { background: var(--color-surface-2); color: var(--color-foreground); }
  .rail-button.on, .rail-button.on:hover:not(:disabled) { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
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
  /* The card opens against its button, over the list's edge, so it reads as the button's own: placed past the list
     column, it stood 300 px from the pointer and went unseen (2026-11-13). */
  .rail-name {
    position: absolute;
    left: calc(100% + 4px);
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
  /* The machines' card opens against its button, the way its menu does, so it reads as the button's own: over the
     list's foot while the pointer is on the button, its foot level with the button's, so a long list of machines
     grows up, inside the window. Its name, then one 20 px line per machine: mark, name, state. */
  .rail-name.machines-name { left: calc(100% + 4px); top: auto; bottom: 0; transform: translateX(-4px); width: max-content; display: grid; grid-template-columns: 7px auto auto; grid-auto-rows: 20px; align-items: center; gap: 4px 8px; padding: 8px 12px; line-height: 20px; }
  .machines-name > :is(.title, .ui-label) { grid-column: 1 / -1; margin-bottom: 2px; }
  .machines-name > .title { display: flex; align-items: center; gap: 4px; }
  /* One grid for every machine, so the names and the states each start on one edge. */
  .machine-line { display: contents; font-weight: 400; }
  .machine-line .ui-label { font-weight: 400; }
  .machine-line .note { padding-left: 12px; }
  .state-dot { width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--color-live); }
  .machine-line[data-tone='success'] .state-dot { background: var(--color-success); }
  /* Out of reach: the offline ring of its list line (MachineOffline), never a filled dot that reads as on. */
  .machine-line[data-tone='offline'] .state-dot { background: transparent; box-shadow: inset 0 0 0 1.5px var(--color-muted-foreground); }
  /* Descendants: the machines button and its card sit inside MachineStatus. An open menu keeps its card away. */
  .slot:hover .rail-name { opacity: 1; transform: translate(0, -50%); transition-delay: 400ms; }
  .slot:has(:global(:focus-visible)) .rail-name { opacity: 1; transform: translate(0, -50%); }
  .slot:has(:global([aria-expanded='true'])) .rail-name { opacity: 0; transition-delay: 0ms; }
  .slot:hover .rail-name.machines-name, .slot:has(:global(:focus-visible)) .rail-name.machines-name { transform: none; }
  .separator { flex: none; width: 28px; height: 1px; background: var(--color-edge); }
  .bots { display: flex; flex: 0 1 auto; flex-direction: column; align-items: center; gap: 8px; width: 100%; min-height: 0; overflow-y: auto; scrollbar-width: none; }
  /* A picture held to move: it dims where it will land; the name cards stay away while it moves. */
  .slot.dragging > .bot { opacity: 0.55; }
  .bots.reordering { cursor: grabbing; }
  .bots.reordering .rail-name { visibility: hidden; }
  /* Fixed against the window, so the scroller does not clip it (placeName), beside its slot as every other card. */
  .bots .rail-name { position: fixed; left: var(--name-x, var(--app-rail)); top: var(--name-y, 0px); }

  /* Activity's count in a small pill on the inbox glyph's lower right corner: a neutral raised ground with the
     digit in the amber ink (amber is a dot or a count, never a filled badge), ringed in the tile's own ground so
     it reads cut out of the glyph and held to it rather than floating beside it. */
  .rail-button { --count-ring: var(--rail-ground); }
  .count {
    position: absolute;
    left: calc(50% + 2px);
    top: calc(50% + 1px);
    min-width: 18px;
    height: 16px;
    box-sizing: border-box;
    padding: 0 5px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--segment-on);
    box-shadow: 0 0 0 2px var(--count-ring);
    color: var(--color-live);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .rail-button:hover:not(:disabled) { --count-ring: var(--color-surface-2); }
  .rail-button.on, .rail-button.on:hover:not(:disabled) { --count-ring: var(--color-surface-3); }
  /* A bot's or a team's one overlay, bottom right of its picture, cut out of the card: the amber dot for its turn,
     the failure's "!", the list rows' turning accent arc for work, a full
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
    background: var(--rail-ground);
  }
  .needs, .news { width: 10px; height: 10px; border-radius: 50%; background: var(--color-live); }
  .news { background: var(--color-foreground); }
  .work svg { width: 14px; height: 14px; overflow: visible; }
  .work circle { fill: none; stroke-width: 2; }
  .work .track { stroke: var(--color-accent); stroke-dasharray: 23.6 31.4; transform-origin: 7px 7px; }
  .work svg { animation: spin 0.9s steps(54) infinite var(--loops); }

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
  .foot .extra:not(:has(:global(button))) { display: none; }
  .foot .status:has(:global(.trigger[aria-expanded='true'])) .pip { height: 36px; }
  .foot :global(.machines.filtered .trigger), .foot :global(.machines .trigger[aria-expanded='true']) { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); border-radius: var(--radius-rail); }
  /* A filter names its machine beside the button: the rail has no room, so the button alone says it, lit. */
  .foot :global(.machines .name) { display: none; }

  @media (max-width: 720px) {
    .app-rail { display: none; }
  }
  /* Still under reduced motion, as Spinner.svelte. */
  @media (prefers-reduced-motion: reduce) { .work svg { animation: none; } }
  :global(html[data-motion='reduced']) .work svg { animation: none; }
</style>
