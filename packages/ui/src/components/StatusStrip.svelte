<script lang="ts">
  import { Archive, Check, ChevronRight } from '@lucide/svelte';
  import { threadBusy } from '@boite/contracts';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { upkeepOf } from '../lib/agent-upkeep';
  import { elapsed, exactTime, relativeTime } from '../lib/format';
  import { minuteClock, secondClock } from '../lib/clock.svelte';
  import { stripState, waitingElsewhere } from '../lib/status-strip';
  import { canMarkDone, markDone } from '../lib/recent.svelte';
  import { archiveThread } from '../lib/archive';
  import { workspace } from '../lib/workspace.svelte';
  import Elapsed from './Elapsed.svelte';

  /**
   * The open thread's one live line, right above the composer: at work and for
   * how long with what it delegated, waiting on the user and since when, or
   * finished with the two ways to put it away. Its right end walks the user to
   * the next thread that waits on them, on any machine, without touching it.
   */
  let { store }: { store: Store } = $props();

  let thread = $derived(store.openThread);
  let state = $derived(thread ? stripState(thread, { permissions: store.pendingPermissions, questions: store.pendingQuestions }) : null);

  // The counts the floating pill used to carry. A persistent agent's memory pass is upkeep, not a subagent.
  let active = $derived((store.delegation?.agents ?? []).filter(agent => threadBusy(agent.thread) && !upkeepOf(store).has(agent.thread.id)));
  let native = $derived((store.delegation?.nativeAgents ?? []).filter(agent => agent.status === 'running'));
  let agents = $derived(active.length + native.length);
  let runs = $derived(thread ? store.workflowsOf(thread.id).filter(run => run.status === 'running') : []);
  /** When the earliest delegated work began: its timer runs on the line once the thread's own turn ended. */
  let delegatedSince = $derived(Math.min(
    ...active.map(agent => agent.lastTurn?.startedAt ?? agent.lastTurn?.queuedAt ?? agent.thread.createdAt),
    ...native.map(agent => agent.startedAt),
    ...runs.map(run => run.createdAt)
  ));

  $effect(() => { if (thread) void store.loadDelegation(thread.id); });
  $effect(() => { if (thread) void store.loadWorkflows(thread.id); });

  let waiting = $derived(waitingElsewhere(workspace.machinesOr(store), { store, threadId: thread?.id ?? null }));
  let next = $derived(waiting[0] ?? null);

  // Seconds count while it works or waits; a finished turn reads in minutes.
  let now = $derived((state?.kind === 'finished' ? minuteClock.now : secondClock.now) + store.clockOffset);
  let finishedLabel = $derived(state?.kind === 'finished'
    ? now - state.at < 60_000 ? strings.chat.strip.finishedNow : fill(strings.chat.strip.finished, { time: relativeTime(state.at, now) })
    : '');
  let doneAllowed = $derived(thread !== null && state?.kind === 'finished' && !thread.agentSessionId && canMarkDone(store, thread));
  let delegated = $derived(agents > 0 || runs.length > 0);
  let shown = $derived(state !== null && (state.kind !== 'finished' || doneAllowed) || delegated || next !== null);

  /** A wait reads like a stopwatch for a day, then in days and hours. */
  function waited(ms: number): string {
    const hours = Math.floor(ms / 3_600_000);
    return hours < 24 ? elapsed(ms) : fill(strings.chat.strip.days, { days: String(Math.floor(hours / 24)), hours: String(hours % 24) });
  }

  function openAgents(): void {
    // One run open: its graph, as the pill's workflow card did; otherwise the whole team.
    if (agents === 0 && runs.length === 1) store.panel.openWorkflow(runs[0]!.id);
    else store.showTeam();
  }
</script>

{#if thread && shown}
  <div class="strip" data-testid="status-strip" data-state={state?.kind ?? 'idle'} role="status">
    {#if state?.kind === 'waiting'}
      <span class="lead waiting" data-testid="status-strip-waiting" title={fill(strings.chat.strip.waitingSince, { time: exactTime(state.since) })}>
        <span class="dot" aria-hidden="true"></span>
        <span class="ui-label">{strings.chat.strip.waiting}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span class="time">{waited(now - state.since)}</span>
      </span>
    {:else if state?.kind === 'working'}
      <span class="lead working" data-testid="status-strip-working">
        <span class="dot pulse" aria-hidden="true"></span>
        <span class="ui-label">{strings.chat.strip.working}</span>
        {#if state.since !== null}<span class="time" data-testid="status-strip-elapsed">{elapsed(now - state.since)}</span>{/if}
      </span>
    {:else if state?.kind === 'finished' && doneAllowed}
      <span class="lead finished" data-testid="status-strip-finished" title={exactTime(state.at)}>
        <Check size={13} strokeWidth={2} aria-hidden="true" />
        <span class="ui-label">{finishedLabel}</span>
      </span>
      <button type="button" class="act" data-testid="status-strip-done" onclick={() => void markDone(store, thread)}><Check size={13} strokeWidth={1.75} /><span class="ui-label">{strings.sidebar.markDone}</span></button>
      <button type="button" class="act" data-testid="status-strip-archive" onclick={() => void archiveThread(store, thread.id)}><Archive size={13} strokeWidth={1.75} /><span class="ui-label">{strings.sidebar.archive}</span></button>
    {/if}
    {#if delegated}
      <!-- What it delegated reads as part of the work, and opens where it is followed. -->
      <button type="button" class="act counts" class:working={state?.kind === 'working'} data-testid="active-subagents" title={strings.chat.strip.showAgents} onclick={openAgents}>
        {#if state !== null}<span class="sep" aria-hidden="true">·</span>{/if}
        {#if agents > 0}<span class="ui-label">{fill(agents === 1 ? strings.chat.strip.subagentOne : strings.chat.strip.subagentMany, { count: String(agents) })}</span>{/if}
        {#if agents > 0 && runs.length > 0}<span class="sep" aria-hidden="true">·</span>{/if}
        {#if runs.length > 0}<span class="ui-label">{fill(runs.length === 1 ? strings.workflow.activeOne : strings.workflow.activeMany, { count: String(runs.length) })}</span>{/if}
        {#if state?.kind !== 'working' && Number.isFinite(delegatedSince)}<span class="sep" aria-hidden="true">·</span><Elapsed startedAt={delegatedSince} finishedAt={null} active />{/if}
      </button>
    {/if}
    {#if next}
      <button
        type="button"
        class="act next"
        data-testid="status-strip-next"
        title={fill(strings.chat.strip.nextTitle, { title: next.thread.title })}
        aria-label={fill(strings.chat.strip.nextTitle, { title: next.thread.title })}
        onclick={() => void workspace.select(next.store, next.thread.id)}
      >
        <span class="ui-label">{fill(strings.chat.strip.next, { count: String(waiting.length) })}</span>
        <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
  </div>
{/if}

<style>
  /* One line at the composer's width, so it reads as the composer's own header. */
  .strip {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(calc(100% - 40px), var(--content));
    height: 24px;
    margin: 0 auto 4px;
    padding: 0 6px;
    box-sizing: border-box;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    container: strip / inline-size;
  }
  .lead { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
  .lead .ui-label { overflow: hidden; text-overflow: ellipsis; }
  .working { color: var(--color-accent); }
  .waiting { color: var(--color-live); font-weight: 500; }
  .time { font-variant-numeric: tabular-nums; }
  .sep { opacity: .6; }
  .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .waiting .dot { background: var(--color-live-fill); }
  .pulse { animation: pulse 1.6s var(--loop-ease-out-quint-48) infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  :global(html[data-motion='reduced']) .strip .pulse { animation: none; }

  /* Text buttons on the line: no box at rest, the hover fill when pointed. */
  .act {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    height: 22px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: background var(--dur-1), color var(--dur-1);
  }
  .act:hover, .act:focus-visible { background: var(--color-hover); color: var(--color-foreground); }
  .counts { padding-left: 0; gap: 4px; }
  .counts.working { color: var(--color-accent); }
  .next { margin-left: auto; color: var(--color-live); font-weight: 500; padding-right: 2px; }
  .lead + .act:not(.counts) { margin-left: 2px; }

  @media (max-width: 720px) {
    .strip { width: calc(100% - 20px); gap: 6px; }
    /* A finger needs 44 px: the target grows past the line, the line does not. */
    .act::after { content: ''; position: absolute; inset: -11px -2px; }
  }
  @container strip (max-width: 420px) {
    .lead.finished .ui-label { max-width: 14ch; }
  }
</style>
