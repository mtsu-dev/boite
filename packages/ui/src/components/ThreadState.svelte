<script lang="ts">
  import { CloudOff, Square } from '@lucide/svelte';
  import { pullRequestWatchWaits, type ThreadSummary } from '@boite/contracts';
  import { backgroundLabel } from '../lib/background';
  import { secondClock } from '../lib/clock.svelte';
  import { ago, elapsed, exactTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { threadState } from '../lib/thread-state';
  import { stateForm } from '../lib/status-order';
  import type { WorkingChildren } from '../lib/thread-rows';
  import FailMark from './FailMark.svelte';

  /**
   * `subagents`: the thread's delegated agents at work or asking, from its
   * store. They decide the state (delegating, or waiting once one asks); their
   * count stays in the tooltip, the thread view shows them.
   * `away`: its machine is not connected, so a turn it last saw at work may have
   * ended long ago. The row says so instead of spinning and counting time.
   * One grammar in every list (rows, Recent, the palette, the phone,
   * Activity), from `stateForm`: the user's turn is an amber dot, a failure
   * its "!" disc, a stop the grey square a stopped subagent wears in the thread
   * (DelegationActivity.svelte), work a still accent arc, an unreached machine
   * its cloud; each mark is followed by its word ("Needs you", "Failed",
   * "Stopped", "Working", "Queued", "Offline") in the row's neutral ink, the hue staying on the mark. News and
   * rest show the time. Work that runs turns its arc in every list, so a row
   * says at a glance that its agent is busy; a queued turn's arc stays still.
   * How long work has run lives in the thread and the tooltip.
   * `fit`: the desktop list, where the word stays at every width a user gets by
   * default and the title gives way first (two lines, cut at a word); the word
   * goes only where the title would keep under about 12 characters a line (the
   * `thread-row` container, ThreadCard.svelte), and the mark stands alone.
   * `mark`: a column that holds the mark only (Activity's mark column, the
   * palette). In both, the word stays in the tooltip and the accessible name.
   * An archived thread carries no live state: its time alone.
   */
  let { thread, now, subagents = null, away = false, mark = false, fit = false }: { thread: Pick<ThreadSummary, 'status' | 'unread' | 'runningSince' | 'requestSince' | 'backgroundWork' | 'openQuestions' | 'lastUserMessageAt' | 'createdAt'> & Partial<Pick<ThreadSummary, 'backgroundWait' | 'pullRequestWatches' | 'archived'>>; now: number; subagents?: WorkingChildren | null; away?: boolean; mark?: boolean; fit?: boolean } = $props();

  function earliest(a: number | null | undefined, b: number | null | undefined): number | null {
    return a == null ? b ?? null : b == null ? a : Math.min(a, b);
  }
  let kind = $derived(thread.archived ? null : threadState(thread, subagents));
  let form = $derived(stateForm(kind));
  /** A delegated agent's wait on its own background work: what it waits for, or what ended without waking it. */
  let wait = $derived(thread.backgroundWait ?? null);
  /** The states that count time: the turn, its sub-agents, or the work it left running. */
  let live = $derived(kind === 'working' || kind === 'delegating' || kind === 'monitoring' || kind === 'background' || kind === 'watching');
  /** The pull requests the row still waits on: their checks run. */
  let watches = $derived((thread.pullRequestWatches ?? []).filter(pullRequestWatchWaits));
  /** What was under way when the machine went away is only its last known state. */
  let stale = $derived(away && (live || kind === 'queued'));
  /**
   * Working and monitoring count from the user's request, so a pause to watch
   * CI and the turn that resumes after it do not reset the clock; watching a
   * pull request counts the same way, from its watch on an older core. A shell left
   * running counts from its own start: it may outlive many requests. A request
   * never starts after the turn that carries it on.
   */
  let since = $derived(
    stale ? null
    : kind === 'working' ? earliest(thread.requestSince, thread.runningSince)
    : kind === 'monitoring' ? thread.requestSince ?? thread.backgroundWork?.since ?? null
    : kind === 'watching' ? thread.requestSince ?? (watches.length ? Math.min(...watches.map(watch => watch.since)) : null)
    : kind === 'delegating' ? subagents?.since ?? null
    : live ? thread.backgroundWork?.since ?? (wait?.state === 'waiting' ? wait.since : null) : null);
  /** Counting time reads the second clock, only while the agent works: the list's clock ticks far slower. */
  let spent = $derived(since === null ? null : elapsed(Math.max(secondClock.now, now) - since));
  /** The word beside the mark: work of every kind reads "Working", its kind in the tooltip; an unreached machine "Offline". */
  let word = $derived(stale ? strings.connection.offline : kind === null ? null : form === 'work' && kind !== 'queued' ? strings.sidebar.state.working : strings.sidebar.state[kind]);
  let label = $derived.by(() => {
    if (kind === null) return null;
    if (kind === 'working') return spent === null ? strings.sidebar.state.working : fill(strings.sidebar.state.workingFor, { elapsed: spent });
    if (kind === 'delegating') {
      const count = subagents?.count ?? 0;
      const head = count === 1 ? strings.sidebar.state.delegatingOne : fill(strings.sidebar.state.delegatingMany, { count: String(count) });
      return spent === null ? head : `${head}\n${spent}`;
    }
    if (kind === 'monitoring' || kind === 'background') {
      const head = spent === null ? strings.sidebar.state[kind] : fill(kind === 'monitoring' ? strings.sidebar.state.monitoringFor : strings.sidebar.state.backgroundFor, { elapsed: spent });
      const what = wait?.state === 'waiting' ? fill(strings.sidebar.state.awaiting, { what: wait.for }) : backgroundLabel(thread.backgroundWork?.kinds ?? []);
      return `${head}\n${what}`;
    }
    if (kind === 'watching') {
      const head = watches.length === 1 ? strings.sidebar.state.watching : fill(strings.sidebar.state.watchingMany, { count: String(watches.length) });
      const queued = (watch: (typeof watches)[number]) => watch.seen?.queue ? ` (${fill(strings.tasks.watchQueued, { position: String(watch.seen.queue.position) })})` : '';
      return `${head}\n${watches.map(watch => `#${watch.number}${queued(watch)}`).join(', ')}${spent === null ? '' : `\n${spent}`}`;
    }
    if (kind === 'interrupted' && wait?.state === 'interrupted') {
      return `${strings.sidebar.state.interrupted}\n${fill(strings.sidebar.state.interruptedBy, { what: wait.for, reason: strings.sidebar.state.interruption[wait.reason] })}`;
    }
    return strings.sidebar.state[kind];
  });
</script>

{#if form === null && !stale}
  <!-- News marks nothing: the title's full ink says it, the time stays. -->
  <span class="when" data-testid={kind === 'done' ? 'thread-state' : undefined} data-state={kind ?? undefined} title={kind === 'done' ? `${strings.sidebar.state.done}\n${exactTime(thread.lastUserMessageAt ?? thread.createdAt)}` : exactTime(thread.lastUserMessageAt ?? thread.createdAt)}>{ago(thread.lastUserMessageAt ?? thread.createdAt, now)}</span>
{:else if kind !== null}
  {@const name = stale ? fill(strings.sidebar.state.unreachableWas, { state: strings.sidebar.state[kind] }) : label}
  <!-- The mark and its word read as one image named by the state: the word may give way to the title (`fit`). -->
  <span class="when state {stale ? 'unreachable' : kind}" class:fit data-testid="thread-state" data-state={stale ? 'unreachable' : kind} title={name} aria-label={name} role="img">
    {#if stale}<CloudOff size={11} aria-hidden="true" />
    {:else if form === 'work'}<span class="work-ring" class:turning={live} aria-hidden="true"></span>
    {:else if kind === 'error'}<FailMark />
    {:else if kind === 'interrupted'}<Square size={9} fill="currentColor" aria-hidden="true" />
    {:else}<span class="dot" class:needs-dot={kind === 'waiting'} aria-hidden="true"></span>{/if}
    {#if !mark}<span class="word ui-label" aria-hidden="true">{word}</span>{/if}
  </span>
{/if}

<style>
  .when {
    flex: none;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-subtle);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-muted-foreground);
  }
  /* The word is the secondary tier, the time's weight in the row's grey: the mark carries the hue. */
  .word { font-weight: 400; }
  /* The desktop list's word goes only where the title beside it would keep under about 12 characters a line:
     measured on the seeded titles beside the widest word, a 198 px row of text in English ("Needs you"), 218 px in
     French ("Vous attend"), a 236 or 256 px list. */
  @container thread-row (max-width: 197.98px) {
    .fit .word { display: none; }
  }
  @container thread-row (max-width: 217.98px) {
    :global(html:lang(fr)) .fit .word { display: none; }
  }
  /* Every mark is 8 px. Work, of any kind: an accent arc that turns while the agent runs (still when queued), so it
     never reads as an idle ring or as the amber of the user's turn; which work it is lives in the tooltip. A
     transform loop stays on the compositor, cheap however many rows work; `--loops` stops it at rest. */
  .work-ring { flex: none; box-sizing: border-box; width: 9px; height: 9px; border: 1.5px solid var(--color-accent); border-top-color: transparent; border-radius: var(--radius-full); transform: rotate(45deg); }
  .work-ring.turning { animation: spin 0.9s steps(54) infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .work-ring.turning { animation: none; } }
  /* The user's turn is an amber dot; a failure has its own shape (FailMark.svelte); a stop is neutral, never red. */
  .dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-live); }
  .state :global(svg) { flex: none; }
  .interrupted :global(svg) { color: var(--color-subtle); }
</style>
