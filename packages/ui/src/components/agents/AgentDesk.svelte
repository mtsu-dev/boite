<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Brain, CalendarDays, Check, ChevronRight, CircleAlert, Monitor, Pencil, TriangleAlert } from '@lucide/svelte';
  import Notice from '../Notice.svelte';
  import type { AgentBrain } from '@boite/contracts';
  import { AgentsView, agentOfThread, liveState, liveStep, statusOf, waitingOn } from '../../lib/agents.svelte';
  import { calendarDay, memoryNotes, runningTurn, turnSteps } from '../../lib/agent-desk';
  import { routeGone } from '../../lib/agent-route';
  import { minuteClock } from '../../lib/clock.svelte';
  import { count } from '../../lib/format';
  import type { Store } from '../../lib/store.svelte';
  import { machineName, workspace } from '../../lib/workspace.svelte';
  import { fill, strings } from '../../lib/strings';
  import { toolLine } from '../../lib/tool-groups';
  import { focusComposer } from '../../lib/focus';
  import Elapsed from '../Elapsed.svelte';
  import Spinner from '../Spinner.svelte';
  import ProviderLogo from '../ProviderLogo.svelte';
  import AgentBrainEditor from './AgentBrainEditor.svelte';
  import AgentRoutines from './AgentRoutines.svelte';
  import BotWorkList from './BotWorkList.svelte';
  import SurfaceHead from '../SurfaceHead.svelte';
  import './agents.css';

  /**
   * The open bot's info panel, one calm column that inspects: who it is
   * (picture, name, what it is for, its model, machine and age), its routines
   * and its memory. On a desktop's Bots page the column chooses its threads and
   * the conversation reads what it does now, so neither is repeated here;
   * elsewhere, and on a phone, Now and its threads follow here.
   */
  let { store }: { store: Store } = $props();
  const view = AgentsView.of(untrack(() => store));
  onMount(() => { view.start(); return () => view.pause(); });
  const phone = new MediaQuery('(max-width: 720px)');

  const t = $derived(strings.agents.deskPanel);
  const thread = $derived(store.openThread?.agentSessionId ? store.openThread : null);
  const agent = $derived(thread ? agentOfThread(view.snapshot, thread.id) : null);
  const status = $derived(agent ? statusOf(view.snapshot, agent.id) : null);
  const pending = $derived(waitingOn(store, thread?.id));
  const standing = $derived(agent ? liveState(agent, status, thread, !!pending) : 'idle');
  /** A removed account: the thread's banner (AgentProblem.svelte) says it with its remedy, so the desk only names it. */
  const gone = $derived(!!agent && routeGone(store, agent.selection));
  const now = $derived(minuteClock.now);

  const turn = $derived(standing === 'working' ? runningTurn(thread) : null);
  const steps = $derived(turn && thread ? turnSteps(thread.messages, turn.id) : []);
  /** The last calls, newest at the bottom: each new one slides in under the others. */
  const recent = $derived(steps.slice(-4));
  const step = $derived(liveStep(status, thread));
  const since = $derived(thread?.runningSince ?? turn?.startedAt ?? null);

  const machine = $derived(workspace.machinesOr(store).find(entry => entry.store === store) ?? null);
  const model = $derived(agent ? (agent.selection.model
    ? store.modelsOf(agent.selection.providerId, agent.selection.accountId).find(entry => entry.id === agent.selection.model)?.name ?? agent.selection.model
    : store.providers.find(entry => entry.id === agent.selection.providerId)?.name ?? agent.selection.providerId) : '');
  /** The work list goes where no column holds it: a phone, another page, or the Bots page with its column folded away. */
  const listsWork = $derived(phone.current || store.page !== 'agents' || store.sidebarCollapsed);
  /** Now is drawn while the bot has something in hand (a turn, a queue, a question, a failure, a pause) and no conversation beside the desk says it. */
  const busy = $derived(listsWork && standing !== 'idle' && standing !== 'archived');

  // The snapshot carries the open agent's desk only; the Agents page asks for it too, this asks wherever the desk is drawn.
  $effect(() => { const id = agent?.id; if (id) untrack(() => view.showDesk(id)); });

  /** Its brain files, kept beside the snapshot and read again when the agent changes. */
  let brain = $state<AgentBrain | null>(null);
  let editing = $state(false);
  /** The memory card shows its first three notes; the brain pane has them all. */
  const notes = $derived(brain ? memoryNotes(brain.memory) : []);
  const revision = $derived(view.snapshot?.revision ?? 0);
  $effect(() => {
    const id = agent?.id, client = store.client;
    void revision;
    if (!id || !client) return;
    let live = true;
    untrack(() => {
      void client.call('agents.brain.get', { agentId: id }).then(value => { if (live) brain = value; }).catch(() => {});
    });
    return () => { live = false; };
  });
</script>

<div class="agent-desk" data-state={standing} data-testid="agent-desk">
  {#if !agent}
    <p class="agent-empty">{strings.app.loading}</p>
  {:else}
    <!-- The bot's column and the thread's header already show its face and name: the desk starts at what it is for. -->
    <!-- Its head says what it is for, as a page's would; the door names the panel. -->
    {#if agent.domain}<SurfaceHead><span class="desk-domain" title={agent.domain} data-testid="desk-domain">{agent.domain}</span></SurfaceHead>{/if}
    <header class="desk-ident" data-testid="desk-ident">
      <div class="desk-chips">
        <span class="desk-meta" data-testid="desk-model"><ProviderLogo providerId={agent.selection.providerId} size={13} />{model}</span>
        {#if machine}<span class="desk-meta" data-testid="desk-machine"><Monitor size={13} strokeWidth={1.75} />{machineName(machine)}</span>{/if}
        <span class="desk-meta" data-testid="desk-since"><CalendarDays size={13} strokeWidth={1.75} />{fill(t.since, { date: calendarDay(agent.createdAt, now) })}</span>
      </div>
    </header>

    <div class="desk-body">
      <div class="desk-col">
        {#if busy}
          <section class="desk-card desk-now" data-state={standing} data-testid="desk-now" aria-live="polite">
            <p class="desk-label">
              {#if standing === 'working'}<Spinner size={11} />{:else if standing === 'error'}<TriangleAlert size={13} strokeWidth={1.75} />{/if}
              <span>{t.now}</span>
              {#if standing === 'working' && since !== null}<span class="desk-label-value"><Elapsed startedAt={since} finishedAt={null} active /></span>{/if}
            </p>
            {#if standing === 'working'}
              {#key step}<strong class="desk-now-line" data-testid="desk-now-step">{step ?? strings.agents.state.working}</strong>{/key}
              {#if steps.length && !recent.length}<span class="desk-now-meta">{steps.length === 1 ? t.stepOne : fill(t.stepMany, { count: String(steps.length) })}</span>{/if}
              <span class="desk-progress" aria-hidden="true"><span></span></span>
            {:else if standing === 'waiting' || standing === 'queued'}
              <strong class="desk-now-line">{standing === 'queued' ? strings.agents.state.queued : pending ?? strings.agents.state.waiting}</strong>
              <span class="desk-now-meta">{t.waitingHint}</span>
            {:else if standing === 'error'}
              <strong class="desk-now-line">{gone ? strings.agents.needsAccount : status?.problem ?? strings.agents.state.error}</strong>
            {:else if standing === 'paused'}
              <strong class="desk-now-line">{strings.agents.state.paused}</strong>
              <span class="desk-now-meta">{t.pausedHint}</span>
            {/if}
            {#if recent.length}
              <details class="desk-activity" data-testid="desk-activity">
                <summary><ChevronRight size={12} class="fold-caret" />{steps.length === 1 ? t.stepOne : fill(t.stepMany, { count: String(steps.length) })}</summary>
                <ol class="desk-steps" data-testid="desk-steps">
                  {#each recent as part (part.toolId)}
                    {@const line = toolLine(part)}
                    <li data-status={part.status}>
                      <span class="desk-step-mark" aria-hidden="true">
                        {#if part.status === 'running'}<Spinner size={10} />{:else if part.status === 'error'}<TriangleAlert size={12} strokeWidth={1.75} />{:else}<Check size={12} strokeWidth={1.75} />{/if}
                      </span>
                      <span class="desk-step-text" class:mono={line.mono} title={line.title}>{line.text}</span>
                    </li>
                  {/each}
                </ol>
              </details>
            {/if}
          </section>
        {/if}

        {#if view.error}<div class="desk-error"><Notice icon={CircleAlert} tone="danger" role="alert" detail={view.error} /></div>{/if}

        <section class="desk-card desk-schedule" data-testid="desk-schedule">
          <AgentRoutines {view} agentId={agent.id} compact />
        </section>
      </div>

      <div class="desk-col">
        <section class="desk-card" data-testid="desk-memory">
          <p class="desk-label">
            <Brain size={13} strokeWidth={1.75} /><span>{t.memory}</span>
            {#if status?.memory?.status === 'error'}<span class="desk-memory-alert" role="img" aria-label={t.memoryProblem} title={status.memory.summary ?? t.memoryProblem} data-testid="desk-memory-alert"><TriangleAlert size={12} /></span>{/if}
            <span class="desk-label-value">{#if brain && notes.length}{notes.length === 1 ? t.noteOne : fill(t.noteMany, { count: count(notes.length) })}{/if}</span>
            {#if store.owner && brain && !editing && brain.memory.trim()}<button type="button" class="ghost small icon" title={strings.agents.edit} aria-label={strings.agents.edit} onclick={() => { editing = true; }} data-testid="desk-memory-edit"><Pencil size={13} strokeWidth={1.75} /></button>{/if}
          </p>
          {#if editing}
            <AgentBrainEditor {view} agentId={agent.id} ondone={saved => { brain = saved; editing = false; }} oncancel={() => { editing = false; }} />
          {:else if brain}
            {#if !brain.memory.trim()}
              <p class="desk-empty desk-empty-row">
                <span>{t.memoryEmpty}</span>
                {#if store.owner}<button type="button" class="small" onclick={() => { editing = true; }} data-testid="desk-memory-edit"><Pencil size={13} strokeWidth={1.75} /><span class="ui-label">{t.memoryAdd}</span></button>{/if}
              </p>
            {:else}
              <ul class="desk-notes" data-testid="desk-memory-text">
                {#each notes.slice(0, 3) as note, index (index)}<li>{note}</li>{/each}
              </ul>
            {/if}
          {/if}
        </section>

        {#if listsWork}
          <section class="desk-card desk-work-card"><BotWorkList {view} agentId={agent.id} ontask={phone.current ? undefined : () => focusComposer({ typing: true })} /></section>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /*
   * Two columns once both fit (the desk floating or alone): what it does on the left (Now, its routines), what it
   * knows and holds on the right (memory, work), each column flush at the top. Narrower, the columns dissolve into
   * the one flowing list, parted like any two sections.
   */
  .desk-col { display: contents; }
  .desk-col + .desk-col > :global(:first-child) { margin-top: 6px; }
  @container (min-width: 660px) {
    .desk-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 36px; align-items: start; }
    .desk-col { display: flex; flex-direction: column; min-width: 0; }
    .desk-col + .desk-col > :global(:first-child) { margin-top: 0; }
  }
  .desk-domain { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-foreground); font-weight: 500; }
  /* In the body (a phone, or the desk alone) the line has the room to wrap. */
  :global(.panel-toolbar) .desk-domain { white-space: normal; line-height: 1.45; }
</style>
