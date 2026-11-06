<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Brain, CalendarDays, Check, ChevronRight, LoaderCircle, Monitor, Pencil, TriangleAlert } from '@lucide/svelte';
  import type { AgentBrain } from '@boite/contracts';
  import { AgentsView, agentOfThread, liveState, liveStep, statusOf, waitingOn } from '../../lib/agents.svelte';
  import { calendarDay, memoryNotes, runningTurn, turnSteps } from '../../lib/agent-desk';
  import { workedTime } from '../../lib/agent-turns';
  import { minuteClock } from '../../lib/clock.svelte';
  import { dateTime } from '../../lib/schedule';
  import { count, relativeTime } from '../../lib/format';
  import type { Store } from '../../lib/store.svelte';
  import { machineName, workspace } from '../../lib/workspace.svelte';
  import { fill, strings } from '../../lib/strings';
  import { toolLine } from '../../lib/tool-groups';
  import Elapsed from '../Elapsed.svelte';
  import Prose from '../Prose.svelte';
  import ProviderLogo from '../ProviderLogo.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import AgentBrainEditor from './AgentBrainEditor.svelte';
  import AgentRoutines from './AgentRoutines.svelte';
  import BotWorkList from './BotWorkList.svelte';
  import './agents.css';

  /**
   * The open bot's info panel, one calm column: who it is (picture, name,
   * what it is for, its model, machine and age), Now while it has a turn in
   * hand, its routines and its memory. On a desktop's Bots page its threads
   * are in the page's column; elsewhere, and on a phone, they follow here.
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
  const now = $derived(minuteClock.now);

  const turn = $derived(standing === 'working' ? runningTurn(thread) : null);
  const steps = $derived(turn && thread ? turnSteps(thread.messages, turn.id) : []);
  /** The last calls, newest at the bottom: each new one slides in under the others. */
  const recent = $derived(steps.slice(-4));
  const step = $derived(liveStep(status, thread));
  const since = $derived(thread?.runningSince ?? turn?.startedAt ?? null);
  /** Now is drawn while the bot has something in hand: a turn, a queue, a question, a failure, a pause. */
  const busy = $derived(standing !== 'idle' && standing !== 'archived');

  const machine = $derived(workspace.machinesOr(store).find(entry => entry.store === store) ?? null);
  const model = $derived(agent ? (agent.selection.model
    ? store.modelsOf(agent.selection.providerId, agent.selection.accountId).find(entry => entry.id === agent.selection.model)?.name ?? agent.selection.model
    : store.providers.find(entry => entry.id === agent.selection.providerId)?.name ?? agent.selection.providerId) : '');
  /** The work list goes where no column holds it. */
  const listsWork = $derived(phone.current || store.page !== 'agents');

  // The snapshot carries the open agent's desk only; the Agents page asks for it too, this asks wherever the desk is drawn.
  $effect(() => { const id = agent?.id; if (id) untrack(() => view.showDesk(id)); });

  /** Its brain files, kept beside the snapshot and read again when the agent changes. */
  let brain = $state<AgentBrain | null>(null);
  let editing = $state(false);
  /** The memory shows its first notes until opened. */
  let memoryOpen = $state(false);
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
    <header class="desk-ident" data-testid="desk-ident">
      <AgentAvatar kind="profile" id={agent.id} name={agent.name} avatar={agent.avatar} size={56} squircle />
      <div class="desk-ident-text">
        <strong class="desk-ident-name">{agent.name}</strong>
        {#if agent.domain}<p class="desk-ident-domain">{agent.domain}</p>{/if}
      </div>
      <div class="desk-chips">
        <span class="desk-meta" data-testid="desk-model"><ProviderLogo providerId={agent.selection.providerId} size={13} />{model}</span>
        {#if machine}<span class="desk-meta" data-testid="desk-machine"><Monitor size={13} strokeWidth={1.75} />{machineName(machine)}</span>{/if}
        <span class="desk-meta" data-testid="desk-since"><CalendarDays size={13} strokeWidth={1.75} />{fill(t.since, { date: calendarDay(agent.createdAt, now) })}</span>
      </div>
    </header>

    <div class="desk-body">
      {#if busy}
        <section class="desk-card desk-now" data-state={standing} data-testid="desk-now" aria-live="polite">
          <p class="desk-label">
            {#if standing === 'working'}<LoaderCircle size={13} strokeWidth={2} class="bot-spin" />{:else if standing === 'error'}<TriangleAlert size={13} strokeWidth={1.75} />{/if}
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
            <strong class="desk-now-line">{status?.problem ?? strings.agents.state.error}</strong>
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
                      {#if part.status === 'running'}<LoaderCircle size={12} strokeWidth={1.75} />{:else if part.status === 'error'}<TriangleAlert size={12} strokeWidth={1.75} />{:else}<Check size={12} strokeWidth={1.75} />{/if}
                    </span>
                    <span class="desk-step-text" class:mono={line.mono} title={line.title}>{line.text}</span>
                  </li>
                {/each}
              </ol>
            </details>
          {/if}
        </section>
      {:else if status?.nextWake && standing === 'idle'}
        <p class="desk-next" data-testid="desk-next">{fill(strings.agents.nextWake, { name: status.nextWake.label, when: dateTime(status.nextWake.at, now) })} · {fill(t.nextIn, { time: workedTime(Math.max(60_000, status.nextWake.at - now)) })}</p>
      {/if}

      {#if view.error}<p class="agent-error desk-error" role="alert">{view.error}</p>{/if}

      <section class="desk-card desk-schedule" data-testid="desk-schedule">
        <AgentRoutines {view} agentId={agent.id} compact />
      </section>

      <section class="desk-card" data-testid="desk-memory">
        <p class="desk-label">
          <Brain size={13} strokeWidth={1.75} /><span>{t.memory}</span>
          {#if status?.memory?.status === 'error'}<TriangleAlert size={12} class="desk-memory-alert" aria-label={t.memoryProblem} />{/if}
          <span class="desk-label-value">{#if brain && notes.length}{notes.length === 1 ? t.noteOne : fill(t.noteMany, { count: count(notes.length) })}{/if}</span>
          {#if store.owner && brain && !editing}<button type="button" class="ghost small icon" title={strings.agents.edit} aria-label={strings.agents.edit} onclick={() => { editing = true; }} data-testid="desk-memory-edit"><Pencil size={13} strokeWidth={1.75} /></button>{/if}
        </p>
        {#if editing}
          <AgentBrainEditor {view} agentId={agent.id} ondone={saved => { brain = saved; editing = false; }} oncancel={() => { editing = false; }} />
        {:else if brain}
          {#if !brain.memory.trim()}
            <p class="desk-empty">{t.memoryEmpty}</p>
          {:else if memoryOpen}
            <div class="desk-memory open" data-testid="desk-memory-text"><Prose text={brain.memory} {store} threadId={thread?.id} /></div>
          {:else}
            <ul class="desk-notes" data-testid="desk-memory-text">
              {#each notes.slice(0, 3) as note, index (index)}<li>{note}</li>{/each}
            </ul>
          {/if}
          {#if brain.memory.trim() && (memoryOpen || notes.length > 3)}
            <button type="button" class="ghost small desk-memory-more" aria-expanded={memoryOpen} onclick={() => { memoryOpen = !memoryOpen; }} data-testid="desk-memory-more">{memoryOpen ? t.memoryLess : t.memoryMore}</button>
          {/if}
        {/if}
        {#if status?.memory}
          {@const pass = status.memory}
          <p class="desk-memory-pass" data-status={pass.status} data-testid="desk-memory-pass" title={pass.summary ?? undefined}>
            <span class="desk-memory-pass-when">{pass.status === 'running' ? t.memoryPass.running : fill(t.memoryPass[pass.status], { when: relativeTime(pass.at, now) })}</span>
            {#if pass.summary && pass.status !== 'running'}<span class="desk-memory-pass-summary">· {pass.summary}</span>{/if}
          </p>
        {/if}
      </section>

      {#if listsWork}
        <section class="desk-card desk-work-card"><BotWorkList {view} agentId={agent.id} /></section>
      {/if}
    </div>
  {/if}
</div>
