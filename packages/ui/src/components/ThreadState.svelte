<script lang="ts">
  import { Bot, CloudOff, Square } from '@lucide/svelte';
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
   * store, with the thread's own ask folded in (`rowAsks`). They decide the state
   * (delegating, or waiting once one asks).
   * `team`: the same children alone, without the thread's own ask. Their count
   * rides a chip after the word, in every state, on a computer and a phone alike,
   * so a parent says how many agents it has at work. Lists that hold the mark
   * only (`mark`) leave it out.
   * `away`: its machine is not connected, so a turn it last saw at work may have
   * ended long ago. The row says so instead of spinning and counting time.
   * One grammar in every list (rows, Recent, the palette, the phone,
   * Activity), from `stateForm`: the user's turn is an amber dot, a failure
   * its "!" disc, a stop the grey square a stopped subagent wears in the thread
   * (DelegationActivity.svelte), work a turning accent arc, an unreached machine
   * its cloud; each mark is followed by its word ("Needs you", "Failed",
   * "Stopped", "Working", "Queued", "Offline") in the row's neutral ink, the hue staying on the mark. News (a
   * turn that ended unread) says "Done" in the success ink, with no mark, before the row's time; rest shows the
   * time alone. Work turns, as it does in the thread; a queued turn's
   * arc waits, still. Work also counts its time, second by second: the turn's
   * clock stands for "Working", the other kinds keep their word and add the
   * clock after it at a lighter weight, sub-agents put it before their chip.
   * `fit`: the desktop list, where the word stays at every width a user gets by
   * default and the title gives way first (two lines, cut at a word); the word
   * goes only where the title would keep under about 12 characters a line (the
   * `thread-row` container, ThreadCard.svelte), and the mark keeps its clock.
   * `mark`: a column that holds the mark only (Activity's mark column, the
   * palette). In both, the word stays in the tooltip and the accessible name.
   * An archived thread carries no live state: its time alone.
   */
  let { thread, now, subagents = null, team = null, away = false, mark = false, fit = false }: { thread: Pick<ThreadSummary, 'status' | 'unread' | 'runningSince' | 'requestSince' | 'backgroundWork' | 'openQuestions' | 'lastUserMessageAt' | 'createdAt'> & Partial<Pick<ThreadSummary, 'backgroundWait' | 'pullRequestWatches' | 'archived'>>; now: number; subagents?: WorkingChildren | null; team?: WorkingChildren | null; away?: boolean; mark?: boolean; fit?: boolean } = $props();

  function earliest(a: number | null | undefined, b: number | null | undefined): number | null {
    return a == null ? b ?? null : b == null ? a : Math.min(a, b);
  }
  let kind = $derived(thread.archived ? null : threadState(thread, subagents));
  let form = $derived(stateForm(kind));
  /** A delegated agent's wait on its own background work: what it waits for, or what ended without waking it. */
  let wait = $derived(thread.backgroundWait ?? null);
  /** The states that count time: the turn, its sub-agents, or the work it left running. */
  let live = $derived(form === 'work' && kind !== 'queued');
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
  /**
   * The word beside the mark: what the work waits on, so a list tells a CI run from a command or a workflow
   * without a hover ("CI running", "Command", "Sub-agents"); the turn itself reads "Working", an unreached
   * machine "Offline". Mixed background work names the heaviest: a workflow, an agent, then a shell.
   */
  let word = $derived.by(() => {
    if (stale) return strings.connection.offline;
    if (kind === null) return null;
    const words = strings.sidebar.state.workWord;
    if (kind === 'delegating' || kind === 'monitoring') return words[kind];
    if (kind === 'watching') return watches.length > 0 && watches.every(watch => watch.seen?.queue && watch.seen.checks.running === 0) ? words.mergeQueue : words.ci;
    if (kind === 'background') {
      const kinds = thread.backgroundWork?.kinds ?? [];
      const heaviest = (['workflow', 'agent', 'shell'] as const).find(each => kinds.includes(each));
      return words[heaviest ?? 'other'];
    }
    return strings.sidebar.state[kind];
  });
  let label = $derived.by(() => {
    const state = strings.sidebar.state;
    if (kind === null) return null;
    if (kind === 'working') return spent === null ? state.working : fill(state.workingFor, { elapsed: spent });
    if (kind === 'delegating') {
      const count = subagents?.count ?? 0;
      const head = count === 1 ? state.delegatingOne : fill(state.delegatingMany, { count: String(count) });
      return spent === null ? head : `${head}\n${spent}`;
    }
    if (kind === 'monitoring' || kind === 'background') {
      const head = spent === null ? state[kind] : fill(kind === 'monitoring' ? state.monitoringFor : state.backgroundFor, { elapsed: spent });
      const what = wait?.state === 'waiting' ? fill(state.awaiting, { what: wait.for }) : backgroundLabel(thread.backgroundWork?.kinds ?? []);
      return `${head}\n${what}`;
    }
    if (kind === 'watching') {
      const head = watches.length === 1 ? state.watching : fill(state.watchingMany, { count: String(watches.length) });
      const queued = (watch: (typeof watches)[number]) => watch.seen?.queue ? ` (${fill(strings.tasks.watchQueued, { position: String(watch.seen.queue.position) })})` : '';
      return `${head}\n${watches.map(watch => `#${watch.number}${queued(watch)}`).join(', ')}${spent === null ? '' : `\n${spent}`}`;
    }
    if (kind === 'interrupted' && wait?.state === 'interrupted') {
      return `${state.interrupted}\n${fill(state.interruptedBy, { what: wait.for, reason: state.interruption[wait.reason] })}`;
    }
    return state[kind];
  });
  /** The sub-agents chip: how many work, or, when none does, how many still ask; a child asking turns it amber. */
  let chip = $derived.by(() => {
    const count = team?.count ?? 0, asking = team?.asking ?? 0;
    if (mark || stale || (count === 0 && asking === 0)) return null;
    const many = (one: string, other: string, n: number) => n === 1 ? one : fill(other, { count: String(n) });
    const atWork = count > 0 ? many(strings.sidebar.state.subagentsOne, strings.sidebar.state.subagentsMany, count) : null;
    const asks = asking > 0 ? many(strings.sidebar.state.subagentsAskingOne, strings.sidebar.state.subagentsAskingMany, asking) : null;
    const shown = count > 0 ? count : asking;
    return { shown, asking: asking > 0, label: [atWork, asks].filter(Boolean).join('\n') };
  });
</script>

{#if kind === 'done' && !mark}
  <!-- A turn that ended unread says "Done" in the success ink, with no mark; the row's time follows it (ThreadHeadline.svelte). -->
  <span class="when state done" data-testid="thread-state" data-state="done" title={`${strings.sidebar.state.done}\n${exactTime(thread.lastUserMessageAt ?? thread.createdAt)}`} aria-label={strings.sidebar.state.done} role="img"><span class="word ui-label" aria-hidden="true">{strings.sidebar.state.done}</span></span>
{:else if form === null && !stale}
  <!-- Rest, and news in a mark column, show the time. -->
  <span class="when" data-testid={kind === 'done' ? 'thread-state' : undefined} data-state={kind ?? undefined} title={kind === 'done' ? `${strings.sidebar.state.done}\n${exactTime(thread.lastUserMessageAt ?? thread.createdAt)}` : exactTime(thread.lastUserMessageAt ?? thread.createdAt)}>{ago(thread.lastUserMessageAt ?? thread.createdAt, now)}</span>
{:else if kind !== null}
  {@const name = stale ? fill(strings.sidebar.state.unreachableWas, { state: strings.sidebar.state[kind] }) : chip ? `${label}\n${chip.label}` : label}
  <!-- The mark and its word read as one image named by the state: the word may give way to the title (`fit`). -->
  <span class="when state {stale ? 'unreachable' : kind}" class:fit data-testid="thread-state" data-state={stale ? 'unreachable' : kind} title={name} aria-label={name} role="img">
    {#if stale}<CloudOff size={11} aria-hidden="true" />
    {:else if form === 'work'}<span class="work-ring" class:turning={kind !== 'queued'} aria-hidden="true"></span>
    {:else if kind === 'error'}<FailMark />
    {:else if kind === 'interrupted'}<Square size={9} fill="currentColor" aria-hidden="true" />
    {:else}<span class="dot" class:needs-dot={kind === 'waiting'} aria-hidden="true"></span>{/if}
    <!-- Waiting on sub-agents, the chip is the word: the robot and their count, no "Sub-agents" before it.
         The turn's clock is its word: a ring that turns beside a time can only be the agent at work. -->
    {#if !mark && !(kind === 'delegating' && chip && !stale) && !(kind === 'working' && spent !== null)}<span class="word ui-label" aria-hidden="true">{word}</span>{/if}
    {#if !mark && spent !== null}<span class="time ui-label" data-testid="thread-elapsed" aria-hidden="true">{spent}</span>{/if}
    {#if chip}<span class="agents" class:asking={chip.asking} data-testid="thread-subagents" data-count={chip.shown} aria-hidden="true"><Bot size={10} /><span class="ui-label">{chip.shown}</span></span>{/if}
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
  /* The word and a lone clock inherit the row's weight. A clock after a word stays lighter in the same hue. */
  .word + .time { font-weight: 400; }
  .state.waiting { color: var(--color-live); }
  .state:is(.working, .queued, .delegating, .monitoring, .background, .watching) { color: var(--color-accent); }
  .state.error { color: var(--color-danger); }
  .state.done { color: var(--color-success); }
  /* The desktop list's word goes only where the title beside it would keep under about 12 characters a line:
     measured on the seeded titles beside the widest word, a 198 px row of text in English ("Needs you"), 218 px in
     French ("Vous attend"), a 236 or 256 px list. */
  @container thread-row (max-width: 197.98px) {
    .fit .word { display: none; }
  }
  @container thread-row (max-width: 217.98px) {
    :global(html:lang(fr)) .fit .word { display: none; }
  }
  /* The sub-agents chip: the robot and the number on a faint wash of the state's hue, amber once a child asks.
     It stays when a narrow list drops the word: the count is the row's only sign of its children. */
  .agents { display: inline-flex; align-items: center; gap: 3px; height: 16px; padding: 0 5px; margin-left: 2px; border-radius: var(--radius-sm); background: color-mix(in srgb, currentColor 14%, transparent); font-weight: 600; color: var(--color-accent); }
  .agents.asking { color: var(--color-live); }
  /* Every mark is 8 px. Work, of any kind: an accent arc that turns (still while queued), so it never reads as an
     idle ring or as the amber of the user's turn; which work it is lives in the tooltip. Its loop steps on the
     shared 60 Hz grid and stops with the window at rest (app.css `--loops`). */
  .work-ring { flex: none; box-sizing: border-box; width: 9px; height: 9px; border: 1.5px solid var(--color-accent); border-top-color: transparent; border-radius: var(--radius-full); transform: rotate(45deg); }
  .work-ring.turning { transform: none; animation: spin 0.9s steps(54) infinite var(--loops); }
  /* The user's turn is an amber dot; a failure has its own shape (FailMark.svelte); a stop is neutral, never red. */
  .dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-live); }
  .state :global(svg) { flex: none; }
  .interrupted :global(svg) { color: var(--color-subtle); }
  /* Still under reduced motion, as Spinner.svelte. */
  @media (prefers-reduced-motion: reduce) { .work-ring.turning { animation: none; } }
  :global(html[data-motion='reduced']) .work-ring.turning { animation: none; }
</style>
