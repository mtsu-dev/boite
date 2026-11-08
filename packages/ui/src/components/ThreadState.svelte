<script lang="ts">
  import { CloudOff } from '@lucide/svelte';
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
   * Activity), from `stateForm`: the user's turn is an amber dot and a failure
   * a red one, with their word only where the row has room (`mark` off); work
   * is a still accent arc alone; news and rest show the time. Lists hold many
   * rows at work: their marks stay still, the one live spinner is the open
   * thread's. How long work has run lives in the thread and the tooltip.
   * `mark`: the desktop list's narrow end, where every mark stands alone, its
   * word in the tooltip and the accessible name.
   * An archived thread carries no live state: its time alone.
   */
  let { thread, now, subagents = null, away = false, mark = false }: { thread: Pick<ThreadSummary, 'status' | 'unread' | 'runningSince' | 'requestSince' | 'backgroundWork' | 'openQuestions' | 'lastUserMessageAt' | 'createdAt'> & Partial<Pick<ThreadSummary, 'backgroundWait' | 'pullRequestWatches' | 'archived'>>; now: number; subagents?: WorkingChildren | null; away?: boolean; mark?: boolean } = $props();

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
  /** The word shows only where the user must act and the row has room for it. */
  let bare = $derived(mark || form === 'mark');
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

{#if stale && kind !== null}
  {@const was = fill(strings.sidebar.state.unreachableWas, { state: strings.sidebar.state[kind] })}
  <span class="when state unreachable" data-testid="thread-state" data-state="unreachable" title={was} aria-label={was}>
    <CloudOff size={11} aria-hidden="true" /><span class="ui-label">{strings.sidebar.state.unreachable}</span>
  </span>
{:else if form === null}
  <!-- News marks nothing: the title's full ink says it, the time stays. -->
  <span class="when" data-testid={kind === 'done' ? 'thread-state' : undefined} data-state={kind ?? undefined} title={kind === 'done' ? `${strings.sidebar.state.done}\n${exactTime(thread.lastUserMessageAt ?? thread.createdAt)}` : exactTime(thread.lastUserMessageAt ?? thread.createdAt)}>{ago(thread.lastUserMessageAt ?? thread.createdAt, now)}</span>
{:else if kind !== null}
  <!-- A mark alone stands for its word: an image named by it. -->
  <span class="when state {kind}" class:mark={bare} data-testid="thread-state" data-state={kind} title={label} aria-label={label} role={bare ? 'img' : undefined}>
    {#if form === 'mark'}<span class="work-ring" aria-hidden="true"></span>
    {:else if kind === 'error' || kind === 'interrupted'}<FailMark />
    {:else}<span class="dot" class:needs-dot={kind === 'waiting'} aria-hidden="true"></span>{/if}
    {#if !bare}<span class="ui-label">{strings.sidebar.state[kind]}</span>{/if}
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
    gap: 5px;
    color: var(--color-muted-foreground);
  }
  /* A word shows only when the user must act: it reads bold, in the row's grey; the dot carries the colour. */
  .waiting, .error, .interrupted { font-weight: 600; }
  /* Every mark is 8 px. Work, of any kind: a still accent arc, a spinner at rest, so it never reads as an idle ring
     or as the amber of the user's turn; which work it is lives in the tooltip. */
  .work-ring { flex: none; box-sizing: border-box; width: 9px; height: 9px; border: 1.5px solid var(--color-accent); border-top-color: transparent; border-radius: var(--radius-full); transform: rotate(45deg); }
  /* The user's turn is an amber dot; a failure has its own shape (FailMark.svelte). */
  .dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-live); }
  .state :global(svg) { flex: none; }
</style>
