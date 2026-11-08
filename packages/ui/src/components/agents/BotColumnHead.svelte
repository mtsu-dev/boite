<script lang="ts">
  import { Brain, Ellipsis, Settings2 } from '@lucide/svelte';
  import type { AgentProfile, AgentStatus, Team, ThreadSummary } from '@boite/contracts';
  import { agentMenuItems, pickAgentAction } from '../../lib/agent-menu';
  import { botLeaving } from '../../lib/agent-move-flow';
  import { liveState, liveStep, waitingOn, type AgentsView } from '../../lib/agents.svelte';
  import { separator, type MenuItem } from '../../lib/menu';
  import type { AgentPane } from '../../lib/store/layout.svelte';
  import { strings } from '../../lib/strings';
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
   * of what it does now (the step it is on and for how long, what it waits
   * on, why it failed, else what it is for), and its menu:
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
  const state = $derived(agent ? liveState(agent, status, thread, !!pending) : 'idle');
  const step = $derived(liveStep(status, thread));
  const since = $derived(thread?.status === 'running' ? thread.runningSince ?? thread.progress?.since ?? null : null);
  /** The one status line, cut at the column's width; its title keeps it whole. The next routine is the desk's to show. */
  const line = $derived(state === 'working' ? step ?? labels.state.working
    : state === 'waiting' ? pending ?? labels.state.waiting
    : state === 'error' ? status?.problem ?? labels.state.error
    : state === 'queued' || state === 'paused' || state === 'archived' ? labels.state[state]
    : agent?.domain || labels.state.idle);
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
<header class="bot-head" data-state={state} data-testid="bot-column-head">
  {#if agent}
    <AgentAvatar kind="profile" id={agent.id} name={agent.name} avatar={agent.avatar} size={40} squircle lit={avatarLit({ open: true })} />
    <div class="bot-head-text">
      <strong class="bot-head-name">{agent.name}{#if agent.builtin}<BuiltinBadge />{/if}</strong>
      <span class="bot-head-live" data-state={state} title={line} aria-live="polite" data-testid="bot-column-live">
        <!-- One signal per state: the spinner or the mark carries the hue, the words stay neutral. -->
        {#if state === 'working'}<span class="bot-spin"><Spinner size={11} /></span>
        {:else if state === 'waiting' || state === 'error'}<span class="bot-spin"><StatusMark tone={state} label={labels.state[state]} /></span>{/if}
        <span class="bot-head-line">{line}</span>
        {#if state === 'working' && since !== null}<span class="bot-head-sep" aria-hidden="true">&nbsp;·&nbsp;</span><span class="bot-head-time"><Elapsed startedAt={since} finishedAt={null} active /></span>{/if}
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
