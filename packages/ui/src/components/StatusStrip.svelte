<script lang="ts">
  import { Archive, ArrowDownToLine, Check, ChevronRight, Network } from '@lucide/svelte';
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

  /**
   * The open thread's one live line, right above the composer: at work and for
   * how long with what it delegated, waiting on the user and since when, or
   * finished with the two ways to put it away. Its right end walks the user to
   * the next thread that waits on them, on any machine, without touching it.
   * What it delegated is one chip, a glyph and a number with its words in the
   * tooltip, so the line stays one line on every width. A finished thread
   * read from far above its end offers the way back to the start of its last
   * answer, where the turn's files and PR sit under it.
   */
  let { store, away = false, onlastanswer }: { store: Store; away?: boolean; onlastanswer?: () => void } = $props();

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
  /** The counts in words, for the chip's name when it shrinks to a glyph and a number. */
  let delegatedWords = $derived([
    agents > 0 ? fill(agents === 1 ? strings.chat.strip.subagentOne : strings.chat.strip.subagentMany, { count: String(agents) }) : null,
    runs.length > 0 ? fill(runs.length === 1 ? strings.workflow.activeOne : strings.workflow.activeMany, { count: String(runs.length) }) : null
  ].filter(Boolean).join(' · '));
  // One timer on the line: the state's own. The group's time shows only when no state does, else in its tooltip.
  let delegatedTime = $derived(delegated && Number.isFinite(delegatedSince) ? elapsed(now - delegatedSince) : null);
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
    <!-- The state never shrinks: what gives way first is the counts, then Next, then a second line. -->
    {#if state?.kind === 'waiting'}
      <span class="lead waiting" data-testid="status-strip-waiting" title={fill(strings.chat.strip.waitingSince, { time: exactTime(state.since) })}>
        <span class="dot" aria-hidden="true"></span>
        <span class="ui-label">{strings.chat.strip.waiting}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span class="time">{waited(now - state.since)}</span>
      </span>
    {:else if state?.kind === 'working' || state?.kind === 'asking'}
      <span class="lead working" data-testid="status-strip-working">
        <span class="dot pulse" aria-hidden="true"></span>
        <span class="ui-label">{strings.chat.strip.working}</span>
        {#if state.since !== null}<span class="time" data-testid="status-strip-elapsed">{elapsed(now - state.since)}</span>{/if}
        {#if state.kind === 'asking'}
          <span class="sep" aria-hidden="true">·</span>
          <span class="asking ui-label" data-testid="status-strip-asking" title={fill(strings.chat.strip.askingSince, { time: exactTime(state.asked) })}>{strings.chat.strip.asking}</span>
        {/if}
      </span>
    {:else if state?.kind === 'finished' && doneAllowed}
      <span class="lead finished" data-testid="status-strip-finished" title={exactTime(state.at)}>
        <Check size={13} strokeWidth={2} aria-hidden="true" />
        <span class="ui-label">{finishedLabel}</span>
      </span>
    {/if}
    {#if state?.kind === 'finished' && doneAllowed && away && onlastanswer}
      <button type="button" class="act last" data-testid="status-strip-last-answer" title={strings.chat.strip.lastAnswerTitle} onclick={onlastanswer}><ArrowDownToLine size={13} strokeWidth={1.75} /><span class="ui-label">{strings.chat.strip.lastAnswer}</span></button>
    {/if}
    {#if state?.kind === 'finished' && doneAllowed}
      <!-- The two ways to put it away travel together: when the line is full they wrap to the second line as one. -->
      <span class="finish">
        <button type="button" class="act" data-testid="status-strip-done" onclick={() => void markDone(store, thread)}><Check size={13} strokeWidth={1.75} /><span class="ui-label">{strings.sidebar.markDone}</span></button>
        <button type="button" class="act" data-testid="status-strip-archive" onclick={() => void archiveThread(store, thread.id)}><Archive size={13} strokeWidth={1.75} /><span class="ui-label">{strings.sidebar.archive}</span></button>
      </span>
    {/if}
    {#if delegated}
      <!-- What it delegated reads as part of the work, and opens where it is followed. -->
      <button
        type="button"
        class="act counts"
        class:working={state?.kind === 'working' || state?.kind === 'asking'}
        data-testid="active-subagents"
        title={[delegatedWords, strings.chat.strip.showAgents, state !== null && delegatedTime ? fill(strings.chat.strip.delegatedFor, { time: delegatedTime }) : null].filter(Boolean).join('\n')}
        aria-label={delegatedWords}
        onclick={openAgents}
      >
        <Network size={13} strokeWidth={1.75} aria-hidden="true" />
        <span class="words" aria-hidden="true">
          {#if agents > 0}<span class="ui-label">{fill(agents === 1 ? strings.chat.strip.subagentOne : strings.chat.strip.subagentMany, { count: String(agents) })}</span>{/if}
          {#if agents > 0 && runs.length > 0}<span class="sep">·</span>{/if}
          {#if runs.length > 0}<span class="ui-label">{fill(runs.length === 1 ? strings.workflow.activeOne : strings.workflow.activeMany, { count: String(runs.length) })}</span>{/if}
        </span>
        <!-- Under 420 px the words give way to the number; the name keeps them. -->
        <span class="number" aria-hidden="true">{agents + runs.length}</span>
        {#if state === null && delegatedTime}<span class="sep" aria-hidden="true">·</span><span class="time">{delegatedTime}</span>{/if}
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
        <!-- One label at every width, never a bare number: it says what it opens, then how many wait. -->
        <span class="jump ui-label" aria-hidden="true">{fill(strings.chat.strip.nextShort, { count: String(waiting.length) })}</span>
        <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
  </div>
{/if}

<style>
  /* One 24 px line at the composer's width, so it reads as the composer's own
     header; a second 24 px line only when the state, the counts and the
     actions cannot share one. */
  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 10px;
    row-gap: 0;
    width: min(calc(100% - 40px), var(--content));
    min-height: 24px;
    margin: 0 auto 4px;
    padding: 0 6px;
    box-sizing: border-box;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    container: strip / inline-size;
  }
  .strip > * { height: 24px; }
  /* The state is never cut: it keeps its whole width and everything else gives way. */
  .lead { display: inline-flex; align-items: center; gap: 6px; flex: none; }
  .working { color: var(--color-accent); }
  /* The dot carries the amber, as the ring does in the list; the words stay ink and the time grey. */
  .waiting { color: var(--color-foreground); font-weight: 500; }
  .waiting .time, .waiting .sep { color: var(--color-muted-foreground); font-weight: 400; }
  .asking { color: var(--color-live); font-weight: 500; }
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
    align-self: center;
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
  .words { display: inline-flex; align-items: center; gap: 4px; }
  .number { display: none; }
  /* The delegated work: one chip at every width, its words in the tooltip. */
  .counts { gap: 4px; padding: 0 8px 0 7px; border-radius: var(--radius-full); background: var(--color-control-surface); }
  .counts .words { display: none; }
  .counts .number { display: inline; }
  .counts.working { color: var(--color-accent); }
  .next { margin-left: auto; color: var(--color-muted-foreground); font-weight: 500; padding-right: 2px; }
  .finish { display: inline-flex; align-items: center; gap: 2px; flex: none; }

  @media (max-width: 720px) {
    /* Above the composer's air under it, so the targets' lower half is theirs and not the composer's. */
    .strip { position: relative; z-index: 1; width: calc(100% - 20px); column-gap: 6px; }
    /* A finger needs 44 px: the target grows past the line, the line does not. */
    .act::after { content: ''; position: absolute; inset: -11px -2px; }
  }
  /* A phone's line: the counts become a glyph and a number, Next a chip with
     its label and count, the finish actions go to a second line together. */
  @container strip (max-width: 420px) {
    .words { display: none; }
    .number { display: inline; }
    .counts, .next { height: 22px; padding: 0 7px; border-radius: var(--radius-full); background: var(--color-control-surface); }
    /* Amber on the see-through control ground fell to 4.3:1 over the light wallpaper's teal: Next gets a solid amber tint. */
    .next { gap: 2px; padding: 0 6px 0 9px; color: var(--color-live); background: color-mix(in oklch, var(--color-live-fill) 14%, var(--color-surface-2)); }
  }
</style>
