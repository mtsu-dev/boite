<script module lang="ts">
  import type { MemoryPass } from '../lib/agent-turns';
  /** A persistent agent's folded steps: how many and what in words, whether they show above the answer, and the click that flips it. */
  export type SummarySteps = { count: number; words: string; open: boolean; toggle: () => void };
  /** The memory pass that followed the turn, and what a click on its mark opens. */
  export type SummaryMemory = { pass: MemoryPass; open?: () => void };
</script>

<script lang="ts">
  import { page } from '../lib/page-hidden.svelte';
  import { ChevronRight, Square, CircleAlert } from '@lucide/svelte';
  import { compactionMark, compactionText, type CompactionPart } from '../lib/tool-groups';
  import type { BackgroundTask, ThreadProgress, Turn } from '@boite/contracts';
  import { clockTime, elapsed, exactTime, formatTokens, relativeTime } from '../lib/format';
  import { totalTokens } from '../lib/usage';
  import { fill, strings } from '../lib/strings';
  import { backgroundLabel } from '../lib/background';
  import { secondClock } from '../lib/clock.svelte';
  import type { Snippet } from 'svelte';
  import InfoTip from './InfoTip.svelte';
  import Spinner from './Spinner.svelte';
  let { turn, workedBefore = 0, clockOffset = 0, progress, waiting = false, activeTool = false, activeContent = false, background = [], stop, pointed = false, tucked = false, steps, memory, compactions = [], actions, heard = null, carded = false }: {
    turn: Turn;
    /** The failure has its own card above (`failureCarded`): the card is its one mark, so the line drops its own. */
    carded?: boolean;
    /**
     * What the user's request this turn belongs to worked before it, in ms,
     * when Boite opened it to carry that request on (`requestWork`). The
     * elapsed time adds the turn's own.
     */
    workedBefore?: number;
    /** How far the core's clock runs ahead of this device's: every time here is the core's. */
    clockOffset?: number;
    progress?: ThreadProgress | null;
    waiting?: boolean;
    /** The message already shows the running tool's activity row. */
    activeTool?: boolean;
    /** Streaming text or reasoning already shows that the agent is working. */
    activeContent?: boolean;
    /** What the agent still runs in the background; only the thread's last turn is handed it. */
    background?: BackgroundTask[];
    /** Ends the agent process and its background work. */
    stop?: () => void;
    /** The pointer is on another message of this turn: the settled summary shows as if its own message were pointed at. */
    pointed?: boolean;
    /**
     * A phone's message that is neither the last answer nor tapped (`MessageReveal`): its buttons wait for a tap,
     * so a settled line with nothing else to say at rest is not drawn, and leaves no band under the answer.
     */
    tucked?: boolean;
    /** A persistent agent's folded steps, counted on the line; the count opens them above the answer. */
    steps?: SummarySteps;
    /** The memory pass that followed this turn: a small mark whose tooltip says what changed. */
    memory?: SummaryMemory;
    /** The automatic compactions that went through after this turn, said on its line (`foldCompactions`). */
    compactions?: CompactionPart[];
    /** The turn's own buttons (copy, retry, fork), at the end of the line. */
    actions?: Snippet;
    /**
     * The machine is out of reach, and when it was last heard from on the core's clock: a running turn is its last
     * known state, so the line says how old that is, with no spinner and no running clock (`lib/machine-away.ts`).
     */
    heard?: number | null;
  } = $props();
  const hidden = $derived(page.hidden);
  const running = $derived(turn.status === 'running');
  const stale = $derived(running && heard !== null);
  /** A running turn held on the user (a permission or a question): the card that asks says so, so the line says no time and no "Working". */
  const held = $derived(running && waiting && !stale);
  /** The second clock ticks while the turn runs and the page is on screen; a settled turn keeps the time it stopped at. */
  const now = $derived((running ? secondClock.now : Date.now()) + clockOffset);
  const compactOperation = $derived(turn.execution?.operation === 'compact');
  const observed = $derived(running && !waiting && !stale && progress?.turnId === turn.id ? progress : null);
  const compacting = $derived(running && !waiting && !stale && (compactOperation || observed?.phase === 'compacting'));
  const lastUpdate = $derived(!stale ? '' : now - heard! < 60_000 ? strings.chat.lastUpdateNow : fill(strings.chat.lastUpdate, { time: relativeTime(heard!, now) }));
  const label = $derived.by(() => {
    if (stale) return lastUpdate;
    if (compacting) return strings.chat.compacting;
    if (turn.status === 'done') return compactOperation ? strings.chat.compactionUnknown : strings.notify.done;
    if (turn.status === 'error') return compactOperation ? strings.chat.compactionFailed : strings.notify.failed;
    if (turn.status === 'stopped') return compactOperation ? strings.chat.compactionStopped : strings.chat.stopped;
    return waiting ? strings.notify.needsYou : strings.chat.working;
  });
  const own = $derived(turn.startedAt === null ? null : Math.max(0, (turn.finishedAt ?? now) - turn.startedAt));
  // A compaction reports its own duration; work counts what the user's request worked before this turn.
  const spent = $derived(own === null ? null : own + (compactOperation ? 0 : Math.max(0, workedBefore)));
  /** This turn's own share, shown on hover when the request spans several turns. */
  const ownLabel = $derived(own !== null && spent !== null && spent - own >= 1000 ? fill(strings.chat.turnOwnTime, { time: elapsed(own) }) : undefined);
  /** A compaction inside a turn counts from when its phase began, which an older core does not send. */
  const compactionSpent = $derived(compactOperation ? spent : observed?.since == null ? null : Math.max(0, now - observed.since));
  const elapsedLabel = $derived(compactOperation ? turn.status === 'done' ? strings.chat.compactedFor : strings.chat.compactionElapsed : running ? strings.chat.workingFor : strings.chat.workedFor);
  const usage = $derived(turn.usage);
  const total = $derived(usage === null ? 0 : totalTokens(usage));
  const breakdown = $derived(usage === null ? '' : [
    fill(strings.chat.inputTokens, { count: formatTokens(usage.inputTokens) }),
    fill(strings.chat.outputTokens, { count: formatTokens(usage.outputTokens) }),
    fill(strings.chat.cacheTokens, { read: formatTokens(usage.cacheReadTokens), write: formatTokens(usage.cacheWriteTokens) }),
  ].join('\n'));
  const still = $derived(backgroundLabel(background.map((task) => task.kind)));
  /** A turn over with nothing left running: its time and tokens wait for the pointer. */
  const settled = $derived((turn.status === 'done' || turn.status === 'stopped') && !still && !compacting);
  const quiet = $derived(observed ? Math.max(0, now - observed.at) : 0);
  const activityLabel = $derived(observed ? strings.chat.progress[observed.phase] : null);
  const providerAge = $derived(observed?.providerAt == null ? null : Math.max(0, now - observed.providerAt));
  const fold = $derived(strings.chat.fold);
  /** What the running turn is doing, in the line's "i": the phase, how long nothing new came, the provider's last word. */
  const liveFacts = $derived.by(() => {
    if (!observed) return [];
    const facts: { id: string; text: string }[] = [];
    if (!activeTool && !activeContent || observed.phase === 'retrying' || quiet >= 60_000) facts.push({ id: 'turn-progress', text: observed.detail ? `${activityLabel}: ${observed.detail}` : activityLabel ?? '' });
    if (quiet >= 60_000) facts.push({ id: 'turn-last-activity', text: fill(strings.chat.noActivity, { time: elapsed(quiet) }) });
    if (quiet >= 60_000 && providerAge !== null && observed.providerAt! > observed.at) facts.push({ id: 'turn-provider-signal', text: fill(strings.chat.providerSignal, { time: elapsed(providerAge) }) });
    return facts;
  });
  /** The mark's tooltip: what the pass did, then its summary. */
  const memoryTitle = $derived(memory ? [fold.memory[memory.pass.status], ...(memory.pass.summary && memory.pass.status !== 'running' ? [memory.pass.summary] : [])].join(' · ') : '');
  /** A line that counts steps or carries a memory mark reads at rest: it is what the agent did, not a measurement. */
  const marked = $derived(!!steps || !!memory || compactions.length > 0);
  const finishedLabel = $derived(turn.finishedAt === null ? '' : fill(turn.status === 'error' && !carded ? strings.chat.failedAt : strings.chat.finishedAt, { time: clockTime(turn.finishedAt) }));
  const tokensLabel = $derived(`${formatTokens(total)} ${strings.units.tokens}`);
  /** Where there is no pointer, a settled line says how long it worked at rest; when it ended and what it spent wait behind one "i". */
  const details = $derived([finishedLabel, total > 0 ? tokensLabel : ''].filter(Boolean).join(' · '));
</script>

{#snippet metric(id: string, text: string | null, title?: string, quiet = false, meta = false)}
  <span class="metric" class:meta><span class="dot ui-label" aria-hidden="true">·</span><span class="ui-label" class:quiet data-testid={id} {title}>{text}</span></span>
{/snippet}
{#if turn.status !== 'queued' && !(held && !still) && !(running && activeTool && !waiting && !stale && background.length === 0 && !observed && !compacting) && !(tucked && settled && !marked)}
  <div class="summary" class:compacting class:stale class:settled class:pointed class:marked class:paused={hidden || waiting} data-testid="turn-summary" data-status={turn.status} role="status" aria-label={label} title={label}>
    {#if compacting}
      <span class="compaction-icon"><Spinner size={16} paused={hidden || waiting} /></span>
      <div class="compaction-copy">
        <span class="compaction-title ui-label">{strings.chat.compacting}</span>
        {#if compactionSpent !== null}
          <span class="compaction-elapsed ui-label" data-testid="compaction-elapsed">{fill(strings.chat.compactionElapsed, { time: elapsed(compactionSpent) })}</span>
        {/if}
      </div>
    {:else}
    <!-- A finished turn needs no tick: its time and the answer above already say it ended; only a failure or a stop is marked. -->
    {#if turn.status === 'error' && !carded}<CircleAlert size={14} />{:else if turn.status === 'stopped'}<Square size={12} />{:else if turn.status !== 'done' && !activeContent && !activeTool && !stale && !held}<Spinner size={12} paused={hidden || waiting} />{/if}
    {#if stale}
      <span class="ui-label meta" data-testid="turn-last-update" title={exactTime(heard!)}>{lastUpdate}</span>
    {:else if spent !== null && !held}
      <span class="ui-label meta" data-testid="turn-elapsed" title={ownLabel}>{fill(elapsedLabel, { time: elapsed(spent) })}</span>
    {/if}
    {#if compactOperation && (turn.status === 'error' || turn.status === 'stopped')}
      {@render metric('compaction-result', label)}
    {/if}
    {#if liveFacts.length}
      <!-- The line keeps one fact, the time; what the agent is doing waits behind the "i". The facts stay in the line, read by screen readers. -->
      <span class="live-tip">
        {#each liveFacts as fact (fact.id)}<span class="visually-hidden" data-testid={fact.id}>{fact.text}</span>{/each}
        <InfoTip text={liveFacts.map((fact) => fact.text).join(' · ')} topic={strings.chat.turnDetails} testid="turn-activity" />
      </span>
    {/if}
    {#if turn.finishedAt !== null}
      {@render metric('turn-finished-at', finishedLabel, exactTime(turn.finishedAt), false, true)}
    {/if}
    {#if (steps || memory) && !running}
      <!-- The count and the memory mark wrap as one, so the mark never starts a line alone. -->
      <span class="metric marks">
        {#if steps}
          <span class="dot ui-label" aria-hidden="true">·</span>
          <button type="button" class="mark steps" aria-expanded={steps.open} title={steps.open ? fold.hideSteps : fold.showSteps} onclick={steps.toggle} data-testid="turn-steps">
            <span class="ui-label">{steps.words}</span><span class="fold-caret" class:open={steps.open} aria-hidden="true"><ChevronRight size={11} /></span>
          </button>
        {/if}
        {#if memory}
          <span class="dot ui-label" aria-hidden="true">·</span>
          <button type="button" class="mark memory" data-status={memory.pass.status} title={memoryTitle} aria-label={memoryTitle} disabled={!memory.open} onclick={memory.open} data-testid="memory-pass">
            <span class="ui-label">{fold.memory[memory.pass.status]}</span>
          </button>
        {/if}
      </span>
    {/if}
    {#if !running}
      {#each compactions as part, at (at)}{@render metric('turn-compaction', compactionMark(part), compactionText(part), true)}{/each}
    {/if}
    {#if total > 0}
      {@render metric('turn-tokens', tokensLabel, breakdown, false, true)}
    {/if}
    {#if still}
      <span class="metric">
        <span class="dot ui-label" aria-hidden="true">·</span>
        <span class="background" data-testid="turn-background" title={background.map((task) => task.description).join('\n')}>
          <span class="pulse" aria-hidden="true"></span><span class="ui-label">{still}</span>
        </span>
        {#if stop && !running}
          <button type="button" class="stop-background" data-testid="turn-background-stop" title={strings.chat.backgroundStop} aria-label={strings.chat.backgroundStop} onclick={stop}>
            <Square size={10} />
          </button>
        {/if}
      </span>
    {/if}
    {#if actions && !running}<span class="tail">{@render actions()}</span>{/if}
    {#if settled && details}<span class="details"><InfoTip text={details} topic={strings.chat.turnDetails} testid="turn-details" /></span>{/if}
    {/if}
  </div>
{/if}

<style>
  .summary { --lead: 10px; display: flex; flex-wrap: wrap; align-self: stretch; align-items: center; gap: 4px 6px; margin: var(--chat-block-gap) 0 0 4px; font-size: var(--text-sm); color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  /* A metric carries its dot, so a dot never ends a line. A line that starts
     with one starts --lead to the left, where the clip hides that dot; whatever
     starts a line without a dot steps back in by --lead. */
  .summary:not(.compacting) { margin-left: calc(4px - var(--lead)); clip-path: inset(-8px -8px -8px var(--lead)); }
  .summary:not(.compacting) > :global(*:first-child:not(.metric)), .tail { margin-left: var(--lead); }
  .metric { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .tail { display: inline-flex; }
  .summary[data-status='running'] { color: var(--color-muted-foreground); }
  /* The machine is away: how old the turn's last known state is comes before it, at the top of its message (a
     flex column), and what it said follows as history (AssistantMessage's `stale`). */
  .summary.stale { order: -1; margin-top: 0; margin-bottom: var(--chat-block-gap); color: var(--color-foreground); }
  /* Read on demand: the message under the pointer or the keyboard shows it, a finger always does. */
  .summary.settled { opacity: 0; transition: opacity var(--dur-2); }
  :global(.message:hover) .summary.settled, .summary.settled.pointed, .summary.settled:focus-within, .summary.settled:not(:has(.tail)) { opacity: 1; }
  /* Pointed from another message of the turn, its buttons show with it. */
  .summary.settled.pointed :global(.act) { opacity: 1; }
  @media (hover: none) { .summary.settled { opacity: 1; } }
  .summary.settled.marked { opacity: 1; }
  /* A line with nothing shown at rest takes no band of its own on a pointer
     device: it waits inside the gap to the next message, one row tall, so the
     buttons come up right under the answer they belong to and cover nothing. */
  @media (hover: hover) {
    .summary.settled:not(.marked):has(.tail) { flex-wrap: nowrap; height: var(--chat-message-gap); margin-top: 0; margin-bottom: calc(-1 * var(--chat-message-gap)); }
  }
  /* A settled line keeps what the agent did at rest (its steps, a memory mark) and
     its buttons; how long it took, when and what it spent wait for the pointer. A
     finger reads how long at rest, the buttons on the same row, and when and what
     it spent behind the "i", the line's last mark. */
  .details { display: none; }
  /* The count's dot hides but keeps its room: taken out, the count opened the line under the clip and lost its number. */
  .summary.settled.marked .meta { display: none; }
  .summary.settled.marked .marks > .dot:first-child { visibility: hidden; }
  :global(.message:hover) .summary.settled.marked .meta, .summary.settled.marked.pointed .meta, .summary.settled.marked:focus-within .meta { display: inline-flex; }
  :global(.message:hover) .summary.settled.marked .marks > .dot:first-child, .summary.settled.marked.pointed .marks > .dot:first-child, .summary.settled.marked:focus-within .marks > .dot:first-child { visibility: visible; }
  @media (hover: none) {
    .summary.settled .metric.meta { display: none; }
    .summary.settled.marked .meta:not(.metric) { display: inline-flex; }
    .summary.settled.marked .marks > .dot:first-child { visibility: visible; }
    .details { display: inline-flex; }
    /* The row starts where the answer's text does. */
    .summary.settled:not(.compacting) { margin-left: calc(-1 * var(--lead)); }
  }
  /* The step count and the memory mark: text buttons on the line, no box, the foreground on hover. */
  .mark { position: relative; display: inline-flex; align-items: center; gap: 2px; height: 18px; padding: 0 2px; margin: -2px 0; border: 0; border-radius: var(--radius-sm); background: none; color: inherit; font-size: inherit; font-variant-numeric: inherit; cursor: pointer; transition: color var(--dur-2) var(--ease-out-quint); }
  /* The line stays 18 px; the target reaches 28 px, a pointer's least, over the gap around it. */
  .mark::after, .stop-background::after { content: ''; position: absolute; inset: -5px; }
  .mark::after { inset-inline: 0; }
  .mark:hover:not(:disabled), .mark:focus-visible { color: var(--color-foreground); background: none; }
  .mark:disabled { cursor: default; }
  .mark.memory[data-status='running'] { animation: pulse 1.6s var(--loop-ease-in-out-48) infinite var(--loops); }
  .mark.memory[data-status='error'] { color: var(--color-danger); }
  @media (prefers-reduced-motion: reduce) { .mark.memory[data-status='running'] { animation: none; } }
  :global(html[data-motion='reduced']) .mark.memory[data-status='running'] { animation: none; }
  .summary[data-status='error'] > :global(svg) { color: var(--color-danger); }
  .summary.compacting { align-self: flex-start; align-items: flex-start; flex-wrap: nowrap; gap: 10px; max-width: 520px; box-sizing: border-box; padding: 12px 14px; border-radius: var(--radius-lg); background: var(--color-surface-2); }
  .compaction-copy { min-width: 0; }
  .compaction-title { display: block; color: var(--color-foreground); font-size: var(--text-sm); font-weight: 400; }
  .compaction-elapsed { display: block; margin-top: 8px; color: var(--color-muted-foreground); }
  .compaction-icon { display: inline-flex; flex: none; margin-top: 2px; }
  .dot { display: inline-block; width: calc(var(--lead) - 6px); text-align: center; opacity: .6; }
  .live-tip { display: inline-flex; align-items: center; }
  .quiet { color: var(--color-muted-foreground); }
  .background { display: inline-flex; align-items: center; gap: 6px; color: var(--color-muted-foreground); }
  .pulse { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 1.6s var(--loop-ease-out-quint-48) infinite var(--loops); }
  .paused .pulse { animation-play-state: paused; }
  .stop-background { position: relative; display: inline-grid; place-items: center; width: 18px; height: 18px; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: transparent; color: var(--color-muted-foreground); cursor: pointer; }
  .stop-background:hover { color: var(--color-danger); border-color: currentColor; }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  :global(html[data-motion='reduced']) .summary .pulse { animation: none; }
</style>
