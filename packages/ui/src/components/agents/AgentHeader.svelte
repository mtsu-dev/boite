<script lang="ts">
  import { ArrowLeft, Brain, ChevronDown, Ellipsis, Archive, Pause, Play, RotateCcw, Search, Settings2 } from '@lucide/svelte';
  import type { AgentProfile, AgentStatus, ThreadSummary } from '@boite/contracts';
  import { moodOf, liveState, liveStep, resetBuiltin, waitingOn, type AgentsView } from '../../lib/agents.svelte';
  import { confirmArchive } from '../../lib/agent-menu';
  import { dateTime } from '../../lib/schedule';
  import type { AgentPane } from '../../lib/store/layout.svelte';
  import type { Store } from '../../lib/store.svelte';
  import { fill, strings } from '../../lib/strings';
  import { minuteClock } from '../../lib/clock.svelte';
  import Menu from '../Menu.svelte';
  import Elapsed from '../Elapsed.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import { avatarLit } from '../../lib/avatar-lit';
  import StatusMark from '../StatusMark.svelte';
  import BuiltinBadge from './BuiltinBadge.svelte';
  import PanelDoor from '../PanelDoor.svelte';
  import { separator, type MenuItem } from '../../lib/menu';

  /**
   * The top of an agent's conversation, in a thread header's pattern: on a
   * desktop its name, the chevron that opens its view menu (find in the
   * conversation, then its settings, its brain, pause and archive), and the
   * same "Panels" door (`PanelDoor.svelte`), which opens on the desk. On a
   * phone (`onback`) it is the screen's only head: its
   * robot in its ring (breathing while it works), its name and one live line
   * that says what it does this second (the step its turn is on, with the time
   * it has run), what it waits on, or when it next wakes. A problem that keeps
   * it from running shows under it, from the page, with the way to fix it.
   * On a desktop the page draws this line in the window's top bar.
   */
  let { store, view, agent, status, thread, onpane, onback }: {
    store: Store;
    view: AgentsView;
    agent: AgentProfile;
    status: AgentStatus | null;
    /** Its thread as the list holds it, live between two snapshots. */
    thread: ThreadSummary | null;
    onpane: (pane: AgentPane) => void;
    /** A phone's way back to the list. */
    onback?: () => void;
  } = $props();

  const labels = $derived(strings.agents);
  const now = $derived(minuteClock.now);
  /** What it waits on: the question it asked, else the permission it needs. */
  const pending = $derived(waitingOn(store, thread?.id));
  const state = $derived(liveState(agent, status, thread, !!pending));
  const step = $derived(liveStep(status, thread));
  const since = $derived(thread?.status === 'running' ? thread.runningSince ?? thread.progress?.since ?? null : null);
  /** The panel button, as on a thread's header: it opens the panel on the desk, whose selector holds every other panel. */
  function togglePanel() {
    if (store.panelOpen) store.panel.hide();
    else store.panel.toggleKind('desk');
  }

  /** How many panels the door holds, as a thread's header counts them. */
  const panelCount = $derived(store.panel.surfaces.length);

  /** The thread menu's order: the view's own Find first, then what is done to the bot, its danger last. */
  const menuItems = $derived<MenuItem[]>([
    ...(thread ? [{ id: 'find', label: strings.palette.find, glyph: Search }, separator('sep-find')] : []),
    { id: 'settings', label: labels.settings, glyph: Settings2 },
    { id: 'brain', label: labels.brain, glyph: Brain },
    ...(store.owner && agent.status !== 'archived' ? [
      agent.status === 'paused' ? { id: 'resume', label: labels.resume, glyph: Play } : { id: 'pause', label: labels.pause, glyph: Pause },
      // A built-in bot is never archived: Reset takes the place of Archive.
      agent.builtin ? { id: 'reset', label: labels.builtin.reset, glyph: RotateCcw, danger: true } : { id: 'archive', label: labels.archive, glyph: Archive, danger: true },
    ] : []),
  ]);

  async function setStatus(next: AgentProfile['status']) {
    const latest = view.snapshot?.profiles.find(p => p.id === agent.id) ?? agent;
    const { id, revision, createdAt: _created, updatedAt: _updated, ...value } = latest;
    await view.call('agents.profile.save', { id, expectedRevision: revision, value: { ...value, status: next } });
  }
  async function pick(id: string) {
    if (id === 'find') {
      store.findOpen = true;
      store.findRequest += 1;
    } else if (id === 'settings' || id === 'brain') onpane(id);
    else if (id === 'pause') await setStatus('paused');
    else if (id === 'resume') await setStatus('active');
    else if (id === 'reset') await resetBuiltin(view, agent);
    else if (id === 'archive' && await confirmArchive(agent.name)) await setStatus('archived');
  }
</script>

<header class="agent-head" class:compact={!onback} data-state={state} data-testid="agent-header">
  {#if onback}
    <button type="button" class="ghost icon agent-mobile-back" aria-label={labels.list} title={labels.list} onclick={onback} data-testid="agent-back"><ArrowLeft size={18} strokeWidth={1.75} /></button>
  {/if}
  <button type="button" class="ghost agent-head-identity" onclick={() => onpane('settings')} aria-label={fill(labels.settingsOf, { name: agent.name })}>
    {#if onback}<span class="agent-head-robot"><AgentAvatar kind="profile" id={agent.id} name={agent.name} avatar={agent.avatar} mood={moodOf(state)} size={32} lit={avatarLit({ open: true })} /></span>{/if}
    <span class="agent-head-text">
      <span class="agent-head-name"><strong>{agent.name}</strong>{#if agent.builtin}<BuiltinBadge word />{/if}</span>
      {#if onback}
        <span class="agent-live" data-state={state} aria-live="polite" data-testid="agent-live">
          <!-- One signal per state: the mark carries the hue, the words stay neutral (AgentRow.svelte). -->
          {#if state === 'working' || state === 'waiting' || state === 'error'}<StatusMark tone={state === 'working' ? 'running' : state} label={labels.state[state]} />{/if}
          {#if state === 'working'}
            <span class="agent-live-text">{step ?? labels.state.working}</span>
            {#if since !== null}<span class="agent-live-time">· <Elapsed startedAt={since} finishedAt={null} active /></span>{/if}
          {:else if state === 'queued'}
            <span class="agent-live-text">{labels.state.queued}</span>
          {:else if state === 'waiting'}
            <span class="agent-live-text">{pending ? fill(labels.waitingOn, { what: pending }) : labels.state.waiting}</span>
          {:else if state === 'error'}
            <span class="agent-live-text">{labels.state.error}</span>
          {:else if state === 'paused' || state === 'archived'}
            <span class="agent-live-text">{labels.state[state]}</span>
          {:else if status?.nextWake}
            <span class="agent-live-text">{fill(labels.nextWake, { name: status.nextWake.label, when: dateTime(status.nextWake.at, now) })}</span>
          {:else}
            <span class="agent-live-text">{agent.domain || labels.state.idle}</span>
          {/if}
        </span>
      {/if}
    </span>
  </button>
  {#if !onback}
    <!-- The view menu right after the name, as a thread's chevron after its title. -->
    <span class="agent-head-menu">
      <Menu placement="bottom" variant="text" label={labels.more} heading={agent.name} testid="agent-menu" items={menuItems} onpick={id => void pick(id)}>
        <ChevronDown size={16} />
      </Menu>
    </span>
  {/if}
  <nav class="agent-head-actions" aria-label={agent.name}>
    <PanelDoor {store} count={panelCount} ontoggle={togglePanel} testid="agent-desk-toggle" />
    {#if onback}
      <Menu placement="bottom" align="end" variant="ghost" label={labels.more} heading={agent.name} testid="agent-menu" items={menuItems} onpick={id => void pick(id)}>
        <Ellipsis size={18} strokeWidth={1.75} />
      </Menu>
    {/if}
  </nav>
</header>
