<script lang="ts">
  import { CircleAlert, CloudOff, GitPullRequest, LoaderCircle, Radar, Network } from '@lucide/svelte';
  import { pullRequestWatchWaits, type ThreadSummary } from '@boite/contracts';
  import { backgroundLabel } from '../lib/background';
  import { ago, exactTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { delegatedChip, shortAgo, shortSpan, threadState } from '../lib/thread-state';
  import type { WorkingChildren } from '../lib/thread-rows';

  /**
   * `subagents`: the thread's delegated agents at work or asking, from its
   * store. Their count rides a chip beside the state, in every state, so a
   * parent at work says it has children on a computer and a phone alike.
   * `away`: its machine is not connected, so a turn it last saw at work may have
   * ended long ago. The row says so instead of spinning and counting time.
   * `compact`: the sidebar's row, whose ring draws the state: only the time,
   * or the elapsed time while it works, in the state's colour. The words stay
   * in its title and label, and the sub-agents chip moves to the row's second line.
   * `waited`: since when it waits on the user (`waitingSince`, the home card's
   * `since`); the compact row's time reads it instead of the last message.
   */
  let { thread, now, subagents = null, away = false, compact = false, waited = null }: { thread: Pick<ThreadSummary, 'status' | 'unread' | 'runningSince' | 'requestSince' | 'backgroundWork' | 'openQuestions' | 'lastUserMessageAt' | 'createdAt'> & Partial<Pick<ThreadSummary, 'backgroundWait' | 'pullRequestWatches'>>; now: number; subagents?: (WorkingChildren & { runs?: number }) | null; away?: boolean; compact?: boolean; waited?: number | null } = $props();

  /**
   * The exact run time in whole minutes, `28m` or `1h 02m`, for the title and
   * label: thirteen rows at work never tick seconds in the corner of the eye.
   * The seconds stay in the open thread's status strip.
   */
  function minutes(ms: number): string {
    const total = Math.floor(Math.max(0, ms) / 60_000);
    if (total < 1) return '<1m';
    return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
  }
  function earliest(a: number | null | undefined, b: number | null | undefined): number | null {
    return a == null ? b ?? null : b == null ? a : Math.min(a, b);
  }
  let kind = $derived(threadState(thread, subagents));
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
  /** Counting time reads the list's own minute clock (`now`): no second clock runs for a row. */
  let spent = $derived(since === null ? null : minutes(now - since));
  /** What a list column shows: one whole unit, floored, as the ages beside it (`1h`, never `1h 30m`); the exact time stays in the title. */
  let shown = $derived(since === null ? null : shortSpan(now - since));
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
  /**
   * The sub-agents chip: how many work, or, when none does, how many still ask.
   * A child asking turns it to the waiting colour and says so in its title.
   */
  let chip = $derived.by(() => {
    const chip = delegatedChip(subagents);
    return chip && { ...chip, text: String(chip.shown) };
  });
</script>

{#if compact && kind !== null}
  {@const text = stale ? null : shown}
  {@const full = stale ? fill(strings.sidebar.state.unreachableWas, { state: strings.sidebar.state[kind] }) : label}
  <span class="when state compact {stale ? 'unreachable' : kind}" class:live={live && !stale} data-testid="thread-state" data-state={stale ? 'unreachable' : kind} title={full} aria-label={full}>
    {#if stale}<CloudOff size={11} aria-hidden="true" />{/if}<span class="ui-label" data-testid="thread-state-text">{text ?? shortAgo(waited ?? thread.lastUserMessageAt ?? thread.createdAt, now)}</span>
  </span>
{:else if stale && kind !== null}
  {@const was = fill(strings.sidebar.state.unreachableWas, { state: strings.sidebar.state[kind] })}
  <span class="when state unreachable" data-testid="thread-state" data-state="unreachable" title={was} aria-label={was}>
    <CloudOff size={11} aria-hidden="true" /><span class="ui-label">{strings.sidebar.state.unreachable}</span>
  </span>
{:else if kind === null}
  <span class="when" class:compact title={exactTime(thread.lastUserMessageAt ?? thread.createdAt)}>{(compact ? shortAgo : ago)(thread.lastUserMessageAt ?? thread.createdAt, now)}</span>
{:else}
  <span class="when state {kind}" data-testid="thread-state" data-state={kind} title={label} aria-label={label}>
    {#if kind === 'working'}<LoaderCircle size={11} class="spinner" aria-hidden="true" /><span class="ui-label">{shown ?? strings.sidebar.state.working}</span>
    {:else if kind === 'delegating'}<span class="ui-label" data-testid="thread-state-text">{shown ?? strings.sidebar.state.delegating}</span>
    {:else if kind === 'monitoring'}<Radar size={11} class="pulse" aria-hidden="true" /><span class="ui-label">{shown ?? strings.sidebar.state.monitoring}</span>
    {:else if kind === 'background'}<span class="dot pulse" aria-hidden="true"></span><span class="ui-label">{shown ?? strings.sidebar.state.background}</span>
    {:else if kind === 'watching'}<GitPullRequest size={11} class="pulse" aria-hidden="true" /><span class="ui-label">{shown ?? strings.sidebar.state.watching}</span>
    {:else if kind === 'interrupted'}<CircleAlert size={11} aria-hidden="true" /><span class="ui-label">{strings.sidebar.state.interrupted}</span>
    {:else}<span class="ui-label">{label}</span>{/if}
    {#if chip}<span class="agents" class:asking={chip.asking} class:pulse={kind === 'delegating'} data-testid="thread-subagents" data-count={chip.shown} role="img" title={chip.label} aria-label={chip.label}><Network size={10} aria-hidden="true" /><span class="ui-label">{chip.text}</span></span>{/if}
  </span>
{/if}

<style>
  /* `--when-color`: a row whose ground darkens (selected, hovered, a second line) gives its time the meta tier. */
  .when {
    flex: none;
    font-size: var(--text-xs);
    color: var(--when-color, var(--color-subtle));
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* The ring says the state: a row's time stays grey at the row's weight, whatever the state. */
  .state.compact, .state.compact.unreachable { color: var(--when-color, var(--color-subtle)); font-weight: 400; }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 500;
  }
  .working {
    color: var(--color-accent);
  }
  .waiting {
    color: var(--color-live);
  }
  .error {
    color: var(--color-danger);
  }
  /* Its background work ended without waking it: it stopped short and needs a resume. */
  .interrupted {
    color: var(--color-danger);
  }
  .done {
    color: var(--color-success);
  }
  .queued,
  .unreachable {
    color: var(--color-muted-foreground);
  }
  /* The turn ended, the agent did not: same colour as working, a slower sign. */
  .delegating,
  .monitoring,
  .background,
  .watching {
    color: var(--color-accent);
  }
  /* The sub-agents chip: the state's own colour on a faint wash of it, the waiting colour once a child asks; the subagent glyph stands for the word, so the chip is only the glyph and the number. */
  .agents {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 16px;
    padding: 0 5px;
    margin-left: 2px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  .agents.asking {
    color: var(--color-live);
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .state :global(.spinner) {
    flex: none;
    animation: spin 1s steps(60) infinite var(--loops);
  }
  /* Waiting on its sub-agents, the chip itself breathes: no second icon beside it. */
  .state :global(.pulse) {
    flex: none;
    animation: pulse 1.6s var(--loop-ease-out-quint-48) infinite var(--loops);
  }
  /* An endless loop stops under reduced motion; the ring keeps its colour. */
  @media (prefers-reduced-motion: reduce) { .state :global(.spinner), .state :global(.pulse) { animation: none; } }
  :global(html[data-motion='reduced']) .state :global(.spinner),
  :global(html[data-motion='reduced']) .state :global(.pulse) { animation: none; }
</style>
