<script lang="ts">
  import type { Component } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Bot, Brain, FilePen, FileText, Globe, Hourglass, Layers, MessageCircleQuestionMark, Moon, PenLine, Play, Plus, RotateCw, Search, SquareTerminal, TriangleAlert, Wrench, X } from '@lucide/svelte';
  import type { AgentProfile, AgentStatus, Team, ThreadSummary } from '@boite/contracts';
  import { agentMenuItems, pickAgentAction, saveAgent } from '../../lib/agent-menu';
  import { botLeaving, leavingLine } from '../../lib/agent-move-flow';
  import { railBotState, type RailBotState } from '../../lib/app-rail';
  import { agentRows, liveActivity, previewOf, waitingOn, type ActivityKind, type AgentMood, type AgentRowData, type AgentsView } from '../../lib/agents.svelte';
  import { contextMenu } from '../../lib/context-menu.svelte';
  import { experimentOn } from '../../lib/experiments.svelte';
  import type { AgentPane } from '../../lib/store/layout.svelte';
  import { strings } from '../../lib/strings';
  import { listNames, watchTeams, type TeamRow } from '../../lib/teams.svelte';
  import { workspace, type Machine } from '../../lib/workspace.svelte';
  import RailFrame from '../RailFrame.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import AgentRow from './AgentRow.svelte';
  import BotColumn from './BotColumn.svelte';
  import BotColumnHead from './BotColumnHead.svelte';
  import { minuteClock } from '../../lib/clock.svelte';

  /**
   * The Bots page's column. On a desktop the window's rail lists the bots, so
   * the column is the selected bot's (`BotColumnHead`, `BotColumn`): who it
   * is, its conversation and the threads it handles, or a team's chat and
   * members.
   *
   * On a phone there is no rail: the column is the Bots screen, the agents
   * listed the way a messenger lists its chats in the thread list's frame
   * (`RailFrame`) under the page's heading, search and New bot: one card of rows,
   * each with its robot by state, its name, what it does this second or the
   * last thing it said, the missed answers or the time, and its next wake.
   * Like the thread list, it holds every connected machine's agents, pinned
   * ones first then newest first, each row with its machine's icon once there
   * are two. A row has the thread
   * rows' menu, cut to what a bot has (`agentMenuItems`), on a right click or
   * a long press. A bot waiting to move once its turn ends says where it goes.
   *
   * With the Teams experiment on, the owner's teams come first, in their own
   * card under their own heading (`docs/teams.md`): one row per team, its
   * members' pictures, its name, who is in it, the time of its last post and
   * the dot of a chat not read. A row opens the team's chat in the card beside.
   * The heading stays while there is no team yet, with its New team button and
   * one line saying what a team is; a search shows it only over the teams it
   * finds. A paired phone keeps the button greyed: a tap says that creating a
   * team stays on the computer.
   */
  type MachineAgents = { machine: Machine; view: AgentsView };
  let { view, lists, active, activeTeam = null, agent = null, status = null, thread = null, team = null, conversation = false, onopen, onteam, oncreate, onnewteam, onengine, onpane }: {
    /** The page's machine: the one a new agent and the engine settings belong to. */
    view: AgentsView;
    /** Each listed machine's agents, the page's own first. */
    lists: MachineAgents[];
    /** The agent whose thread is open, on the page's machine. */
    active: string | null;
    /** The chat thread of the team open, on the page's machine. */
    activeTeam?: string | null;
    /** The open bot, its status and thread row, for its desktop column. */
    agent?: AgentProfile | null;
    status?: AgentStatus | null;
    thread?: ThreadSummary | null;
    /** The open team, for its desktop column. */
    team?: Team | null;
    /** The card beside shows the conversation, no form over it. */
    conversation?: boolean;
    /** Opens the agent, with one of its panes when named. */
    onopen: (machine: Machine, agentId: string, pane?: AgentPane) => void;
    onteam: (machine: Machine, team: Team) => void;
    oncreate: () => void;
    /** Opens the dialog that creates a team on the page's machine. */
    onnewteam?: () => void;
    onengine: () => void;
    /** Opens one of the open bot's panes over its conversation. */
    onpane: (pane: AgentPane) => void;
  } = $props();

  const labels = $derived(strings.agents);
  const uid = $props.id();
  let query = $state('');
  let searching = $state(false);
  const now = $derived(minuteClock.now);

  const phone = new MediaQuery('(max-width: 720px)');
  /** The page's own machine, which a desktop column's actions go through. */
  const here = $derived(lists.find(list => list.view === view)?.machine ?? null);
  const multi = $derived(workspace.machinesOr(view.store).length > 1);
  const needle = $derived(query.trim().toLowerCase());
  const rows = $derived(lists
    .flatMap(list => agentRows(list.view.snapshot).filter(row => !needle || row.profile.name.toLowerCase().includes(needle)).map(row => ({ ...list, row })))
    .sort((a, b) => Number(b.row.profile.pinned === true) - Number(a.row.profile.pinned === true) || b.row.at - a.row.at || a.row.profile.name.localeCompare(b.row.profile.name)));
  /** A search also reaches what the list leaves out: archived agents. */
  const found = $derived(needle ? lists.flatMap(({ machine, view: owner }) =>
    (owner.snapshot?.profiles ?? []).filter(a => a.status === 'archived' && a.name.toLowerCase().includes(needle)).map(profile => ({ machine, profile }))) : []);

  /** The listed machines' teams, read only while the experiment is on: the phone's list draws them, a desktop's column the open one. */
  const watched = watchTeams(() => experimentOn('teams') ? lists.map(list => list.machine) : []);
  /** The teams a search names, the one with the latest post first. */
  const teams = $derived(watched()
    .filter(({ team }) => !needle || team.name.toLowerCase().includes(needle))
    .sort((a, b) => lastPost(b) - lastPost(a) || a.team.name.localeCompare(b.team.name)));
  const teamsOn = $derived(experimentOn('teams'));
  /** The Teams section: always while Teams is on, and under a search only over the teams it found. */
  const teamsShown = $derived(teamsOn && (needle ? teams.length > 0 : true));
  /** A paired phone tapped the greyed New team: the reason shows under the heading. */
  let guestNote = $state(false);
  function newTeam() {
    if (!view.store.owner) { guestNote = !guestNote; return; }
    onnewteam?.();
  }
  function lastPost({ team, chat }: TeamRow): number {
    return chat?.updatedAt ?? team.updatedAt;
  }
  /** The members as pictures: the bot's own when its machine's agents are read, else the robot its id picks. */
  function pictures({ machine, team }: TeamRow): Pick<AgentProfile, 'id' | 'name' | 'avatar'>[] {
    const profiles = lists.find(list => list.machine === machine)?.view.snapshot?.profiles ?? [];
    return team.members.map(member => profiles.find(profile => profile.id === member.botId) ?? { id: member.botId, name: member.name, avatar: '' });
  }

  /** The thread's row, live between two snapshots, when this client holds it. */
  function threadOf(machine: Machine, status: AgentStatus | null): ThreadSummary | null {
    return status?.threadId ? machine.store.threads.find(t => t.id === status.threadId) ?? null : null;
  }
  type Tone = 'idle' | 'working' | 'queued' | 'waiting' | 'error' | 'asleep';
  /** The row's words for the rail's states: one decision (`railBotState`) for both. */
  const TONES: Record<RailBotState, Tone> = { idle: 'idle', working: 'working', queued: 'queued', waiting: 'waiting', failed: 'error', paused: 'asleep' };
  function toneOf(row: AgentRowData, thread: ThreadSummary | null, asking: boolean): Tone {
    return TONES[railBotState(row.profile, row.status, thread, asking)];
  }
  /** The glyph of each kind of step, the way the timeline draws its calls. */
  const GLYPHS: Record<ActivityKind, Component<{ size?: number; strokeWidth?: number }>> = {
    command: SquareTerminal, edit: FilePen, write: FilePen, read: FileText, search: Search, fetch: Globe, web: Globe, agent: Bot, other: Wrench,
    sleep: Hourglass, thinking: Brain, compacting: Layers, starting: Play, retrying: RotateCw, provider: Hourglass, writing: PenLine,
  };
  /**
   * What the row says under the name, with its glyph: the step it is on while
   * it works, the question it waits on, why it failed, that it sleeps, else
   * the last thing it said; a new agent shows what it is for.
   */
  function lineOf(machine: Machine, row: AgentRowData, thread: ThreadSummary | null, tone: Tone): { text: string; icon?: Component<{ size?: number; strokeWidth?: number }> } {
    if (tone === 'asleep') return { text: labels.state.paused, icon: Moon };
    if (tone === 'working') {
      const step = liveActivity(row.status, thread);
      return { text: step?.text ?? labels.state.working, icon: GLYPHS[step?.kind ?? 'thinking'] };
    }
    if (tone === 'queued') return { text: labels.state.queued, icon: Hourglass };
    if (tone === 'waiting') return { text: waitingOn(machine.store, row.status?.threadId) ?? labels.state.waiting, icon: MessageCircleQuestionMark };
    if (tone === 'error') return { text: row.status?.problem ?? labels.state.error, icon: TriangleAlert };
    return { text: row.status?.last ? previewOf(row.status.last.text) : row.profile.domain };
  }
  /** What the ring says: the tone, with answers not read yet over a rest. */
  function moodOf(tone: Tone, unread: number): AgentMood {
    return tone === 'idle' && unread > 0 ? 'unread' : tone;
  }
  function earliest(a: number | null | undefined, b: number | null | undefined): number | null {
    return a == null ? b ?? null : b == null ? a : Math.min(a, b);
  }
  /** The row whose name is a field, `[machine, agent]`: ids can collide between machines. */
  let renaming = $state<string | null>(null);
  const rowKey = (machine: Machine, id: string) => JSON.stringify([machine.id, id]);
  /** The row's menu, answered through the bot's own machine; the toast it may raise is the page's. */
  function menu(event: MouseEvent, machine: Machine, owner: AgentsView, id: string) {
    const agent = owner.snapshot?.profiles.find(p => p.id === id);
    const items = agent ? agentMenuItems(owner.store, agent, { open: owner === view && active === id, phone: phone.current, leaving: botLeaving(owner, id) !== null }) : [];
    if (!agent || !items.length) return;
    contextMenu.open(event, items, action => pickAgentAction(owner, agent, action, {
      open: () => onopen(machine, id),
      edit: () => onopen(machine, id, 'settings'),
      rename: () => { renaming = rowKey(machine, id); },
      report: view.store
    }));
  }
  function rename(owner: AgentsView, id: string, name: string | null) {
    renaming = null;
    const next = name?.trim() ?? '';
    const agent = owner.snapshot?.profiles.find(p => p.id === id);
    if (next && agent && next !== agent.name) void saveAgent(owner, id, { name: next }, view.store);
  }
  let searchToggle = $state<HTMLButtonElement>();
  /** The field unmounts under the focus: it goes back to the button that opened it. */
  function closeSearch() { searching = false; query = ''; searchToggle?.focus(); }
</script>

<RailFrame store={view.store} kind="agents-rail" label={phone.current ? labels.heading : agent?.name ?? team?.name ?? labels.heading}>
  {#snippet head()}
    {#if !phone.current}
      <BotColumnHead {view} {agent} {status} {thread} {team} {onpane} {onengine} onopen={pane => agent && here && onopen(here, agent.id, pane)} />
    {:else}
      <div class="agents-phone-head">
        <h2 class="agents-phone-title">{labels.heading}</h2>
        <button type="button" class="ghost icon small" bind:this={searchToggle} class:active={searching} aria-pressed={searching} title={labels.search} aria-label={labels.search} onclick={() => (searching ? closeSearch() : (searching = true))} data-testid="agents-search-toggle"><Search size={16} /></button>
        {#if view.store.owner}
          <button type="button" class="ghost icon small" title={labels.newAgent} aria-label={labels.newAgent} onclick={oncreate} data-testid="agents-create"><Plus size={16} /></button>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#snippet subhead()}
    {#if phone.current && searching}
      <label class="agents-search"><Search size={14} strokeWidth={1.75} />
        <!-- svelte-ignore a11y_autofocus -->
        <input type="search" bind:value={query} aria-label={labels.search} placeholder={labels.search} autofocus onkeydown={e => { if (e.key === 'Escape') closeSearch(); }} />
        <button type="button" class="ghost icon small" aria-label={strings.common.close} onclick={closeSearch}><X size={13} /></button>
      </label>
    {/if}
  {/snippet}

  {#if !phone.current}
    <BotColumn {view} {agent} {team} {conversation}
      onconversation={() => { if (agent && here) onopen(here, agent.id); else if (team && here) onteam(here, team); }}
      onmember={id => here && onopen(here, id)} />
  {:else}
    {@render list()}
  {/if}
</RailFrame>

{#snippet list()}
  {#if teamsShown}
    <div class="agents-section agents-section-head">
      <h2 class="section-label" id="{uid}-teams">{strings.teamChat.heading}</h2>
      {#if onnewteam}
        <button type="button" class="ghost icon small" aria-disabled={view.store.owner ? undefined : 'true'} title={view.store.owner ? strings.teamChat.newTeam : strings.teamChat.onComputer}
          aria-label={strings.teamChat.newTeam} aria-describedby={guestNote ? `${uid}-teams-guest` : undefined} onclick={newTeam} data-testid="agents-new-team"><Plus size={15} /></button>
      {/if}
    </div>
    {#if guestNote && !view.store.owner}<p class="agents-teams-note" id="{uid}-teams-guest" role="status" data-testid="agents-teams-guest">{strings.teamChat.onComputer}</p>{/if}
    {#if teams.length}
      <section class="agents-card" aria-labelledby="{uid}-teams" data-testid="agents-teams">
        {#each teams as row (`${row.machine.id}:${row.team.id}`)}
          {@const names = listNames(row.team.members.map(member => member.name))}
          <AgentRow title={row.team.name} open={row.machine.store === view.store && activeTeam === row.team.threadId} marked={!!row.chat?.unread}
            away={row.machine.store.connection !== 'ready'} at={lastPost(row)} {now} detail={names} tone={row.team.paused ? 'asleep' : 'idle'}
            machine={multi ? row.machine : undefined} testid="agent-team-{row.team.id}" onclick={() => onteam(row.machine, row.team)}>
            {#snippet picture()}<AgentAvatar kind="team" id={row.team.id} name={row.team.name} members={pictures(row)} size={34} />{/snippet}
          </AgentRow>
        {/each}
      </section>
    {:else}
      <p class="agents-teams-note" data-testid="agents-teams-empty">{strings.teamChat.noTeams}</p>
    {/if}
    {#if rows.length}<h2 class="agents-section section-label" data-testid="agents-bots-heading">{labels.heading}</h2>{/if}
  {/if}
  {#if rows.length}
    <section class="agents-card" aria-label={labels.heading}>
      {#each rows as { machine, view: owner, row } (JSON.stringify([machine.id, row.profile.id]))}
        {@const thread = threadOf(machine, row.status)}
        {@const tone = toneOf(row, thread, !!waitingOn(machine.store, row.status?.threadId))}
        {@const line = lineOf(machine, row, thread, tone)}
        {@const unread = row.status?.unread ?? 0}
        <AgentRow title={row.profile.name} builtin={!!row.profile.builtin} open={owner === view && active === row.profile.id} {unread} away={machine.store.connection !== 'ready'}
          at={row.status?.last?.at ?? 0} {now} tone={tone === 'queued' ? 'idle' : tone} detail={line.text} icon={line.icon}
          since={tone === 'working' ? earliest(thread?.requestSince, thread?.runningSince) : null}
          wake={tone === 'idle' && row.profile.status === 'active' && row.status?.nextWake ? row.status.nextWake : null}
          machine={multi ? machine : undefined} testid="agent-entry-{row.profile.id}" onclick={() => onopen(machine, row.profile.id)}
          pending={leavingLine(owner, row.profile.id)} pinned={row.profile.pinned === true} onmenu={event => menu(event, machine, owner, row.profile.id)}
          renaming={renaming === rowKey(machine, row.profile.id)} onrename={name => rename(owner, row.profile.id, name)}>
          {#snippet picture()}<AgentAvatar kind="profile" id={row.profile.id} name={row.profile.name} avatar={row.profile.avatar} mood={moodOf(tone, unread)} size={34} ring />{/snippet}
        </AgentRow>
      {/each}
    </section>
  {/if}
  {#if found.length}
    <section class="agents-card">
      {#each found as entry (JSON.stringify([entry.machine.id, entry.profile.id]))}
        <AgentRow title={entry.profile.name} at={0} {now} detail={labels.state.archived} machine={multi ? entry.machine : undefined} testid="agent-entry-{entry.profile.id}" onclick={() => onopen(entry.machine, entry.profile.id)}>
          {#snippet picture()}<AgentAvatar kind="profile" id={entry.profile.id} name={entry.profile.name} avatar={entry.profile.avatar} size={34} />{/snippet}
          {#snippet aside()}{/snippet}
        </AgentRow>
      {/each}
    </section>
  {/if}
  {#if needle && !rows.length && !found.length && !teams.length}<p class="agent-empty">{labels.noMatch}</p>{/if}

{/snippet}
