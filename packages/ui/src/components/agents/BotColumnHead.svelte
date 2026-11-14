<script lang="ts">
  import { untrack } from 'svelte';
  import { Brain, Ellipsis, Settings2 } from '@lucide/svelte';
  import type { AgentProfile, AgentStatus, Team, ThreadSummary } from '@boite/contracts';
  import { agentMenuItems, pickAgentAction } from '../../lib/agent-menu';
  import { botLeaving } from '../../lib/agent-move-flow';
  import { liveState, liveStep, waitingOn, type AgentsView } from '../../lib/agents.svelte';
  import { routeGone } from '../../lib/agent-route';
  import { separator, type MenuItem } from '../../lib/menu';
  import type { AgentPane } from '../../lib/store/layout.svelte';
  import { minuteClock } from '../../lib/clock.svelte';
  import { count } from '../../lib/format';
  import { dateTime } from '../../lib/schedule';
  import { fill, strings } from '../../lib/strings';
  import { formatMetric } from '../../lib/usage';
  import InfoTip from '../InfoTip.svelte';
  import { listNames } from '../../lib/teams.svelte';
  import Menu from '../Menu.svelte';
  import Elapsed from '../Elapsed.svelte';
  import Spinner from '../Spinner.svelte';
  import StatusMark from '../StatusMark.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import { avatarLit } from '../../lib/avatar-lit';
  import BuiltinBadge from './BuiltinBadge.svelte';

  /**
   * The top of the selected bot's column: its picture, its name and one line
   * of what it does now (the step it is on, what it waits on, why it failed,
   * else its next wake, else what it is for), how long its turn has run beside
   * its name, its day behind an "i" (how often it woke on its own and what
   * that cost), and its menu:
   * the row menu of the bot lists (`agentMenuItems`), its brain, and the
   * settings all bots share. A team shows its picture, its name and who is in
   * it; its menu stays over its chat. Under the column's title
   * (SideHead.svelte), which leads back to the threads.
   */
  let { view, agent = null, status = null, thread = null, team = null, onopen, onpane, onengine }: {
    view: AgentsView;
    agent?: AgentProfile | null;
    status?: AgentStatus | null;
    thread?: ThreadSummary | null;
    team?: Team | null;
    /** Opens the bot's conversation, with one of its panes when named. */
    onopen: (pane?: AgentPane) => void;
    onpane: (pane: AgentPane) => void;
    onengine: () => void;
  } = $props();

  const labels = $derived(strings.agents);
  const store = $derived(view.store);
  const pending = $derived(waitingOn(store, thread?.id));
  const standing = $derived(agent ? liveState(agent, status, thread, !!pending) : 'idle');
  const step = $derived(liveStep(status, thread));
  const since = $derived(thread?.status === 'running' ? thread.runningSince ?? thread.progress?.since ?? null : null);
  /** A removed account is a need, not a failed turn: the banner over the chat says how to meet it. */
  const failure = $derived(agent && routeGone(store, agent.selection) ? labels.needsAccount : status?.problem ?? labels.state.error);
  /** At rest, an active bot says when it wakes next: the one thing its column cannot show otherwise. */
  const wake = $derived(standing === 'idle' && agent?.status === 'active' && status?.nextWake ? status.nextWake : null);
  /** The one status line, cut at the column's width; its title keeps it whole. */
  const line = $derived(standing === 'working' ? step ?? labels.state.working
    : standing === 'waiting' ? pending ?? labels.state.waiting
    : standing === 'error' ? failure
    : standing === 'queued' || standing === 'paused' || standing === 'archived' ? labels.state[standing]
    : wake ? fill(labels.nextWake, { name: wake.label, when: dateTime(wake.at, minuteClock.now) })
    : agent?.domain || labels.state.idle);

  /** Its daily budget, read beside the snapshot: only its settings carry it. */
  let budget = $state<number | null>(null);
  const revision = $derived(view.snapshot?.revision ?? 0);
  $effect(() => {
    const id = agent?.id, client = store.client;
    void revision;
    if (!id || !client) { budget = null; return; }
    let live = true;
    untrack(() => {
      void client.call('agents.runtime.get', { agentId: id }).then(value => { if (live) budget = value.dailyBudgetUsd ?? null; }).catch(() => { if (live) budget = null; });
    });
    return () => { live = false; };
  });
  /** Its day in a sentence or two: the wakes it took alone, the quiet ones among them, and what they cost. */
  const day = $derived.by(() => {
    const today = status?.today;
    if (!today) return '';
    const d = labels.today;
    const some = (words: { one: string; many: string }, n: number) => n === 1 ? words.one : fill(words.many, { count: count(n) });
    const wakes = today.wakes ? `${some(d.wakes, today.wakes)}${today.quiet ? `, ${some(d.quiet, today.quiet)}` : ''}.` : d.none;
    const cost = today.costUsd > 0 || budget !== null
      ? ` ${budget !== null ? fill(d.costOf, { cost: formatMetric('cost', today.costUsd), budget: formatMetric('cost', budget) }) : fill(d.cost, { cost: formatMetric('cost', today.costUsd) })}.` : '';
    return wakes + cost;
  });
  const pictures = $derived((team?.members ?? []).map(member => view.snapshot?.profiles.find(profile => profile.id === member.botId) ?? { id: member.botId, name: member.name, avatar: '' }));

  const items = $derived.by((): MenuItem[] => {
    if (!agent) return [];
    const base = agentMenuItems(store, agent, { open: !!thread, leaving: botLeaving(view, agent.id) !== null });
    return [
      ...base,
      { id: 'brain', label: labels.brain, glyph: Brain },
      ...(store.owner ? [separator('sep-engine'), { id: 'engine', label: labels.engineSettings, glyph: Settings2 }] : []),
    ];
  });
  function pick(id: string) {
    if (!agent) return;
    if (id === 'brain') { onpane('brain'); return; }
    if (id === 'engine') { onengine(); return; }
    // The column has no name field: a rename happens in its settings.
    pickAgentAction(view, agent, id, { open: () => onopen(), edit: () => onpane('settings'), rename: () => onpane('settings'), report: store });
  }
</script>

<!-- With none picked, the column's head (SideHead.svelte) already names it. -->
{#if agent || team}
<header class="bot-head" data-state={standing} data-testid="bot-column-head">
  {#if agent}
    <AgentAvatar kind="profile" id={agent.id} name={agent.name} avatar={agent.avatar} size={40} squircle lit={avatarLit({ open: true })} />
    <div class="bot-head-text">
      <span class="bot-head-top">
        <strong class="bot-head-name">{agent.name}{#if agent.builtin}<BuiltinBadge />{/if}</strong>
        {#if day && agent.status !== 'archived'}<InfoTip text={day} topic={labels.today.topic} testid="bot-column-day" />{/if}
        <!-- How long the turn has run sits beside the name, so the step under it keeps the whole line. -->
        {#if standing === 'working' && since !== null}<span class="bot-head-time" data-testid="bot-column-elapsed"><Elapsed startedAt={since} finishedAt={null} active /></span>{/if}
      </span>
      <span class="bot-head-live" data-state={standing} title={line} aria-live="polite" data-testid="bot-column-live">
        <!-- One signal per state: the spinner or the mark carries the hue, the words stay neutral. -->
        {#if standing === 'working'}<span class="bot-spin"><Spinner size={11} /></span>
        {:else if standing === 'waiting' || standing === 'error'}<span class="bot-spin"><StatusMark tone={standing} label={standing === 'error' ? failure : labels.state[standing]} /></span>{/if}
        <span class="bot-head-line">{line}</span>
      </span>
    </div>
    {#if items.length}
      <Menu placement="bottom" align="end" variant="ghost" label={labels.more} testid="bot-column-menu" {items} onpick={pick}><Ellipsis size={16} strokeWidth={1.75} /></Menu>
    {/if}
  {:else if team}
    <AgentAvatar kind="team" id={team.id} name={team.name} members={pictures} size={40} squircle lit={avatarLit({ open: true })} />
    <div class="bot-head-text">
      <strong class="bot-head-name">{team.name}</strong>
      <span class="bot-head-live"><span class="bot-head-line">{team.archived ? strings.teamChat.archivedShort : team.paused ? strings.teamChat.pausedShort
        : listNames(team.members.map(member => member.name))}</span></span>
    </div>
  {/if}
</header>
{/if}
