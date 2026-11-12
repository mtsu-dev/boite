<script lang="ts">
  import { secondClock } from '../lib/clock.svelte';
  import { Bot, Brain, ChevronRight, FoldVertical, FilePen, FileText, Globe, Search, ShieldCheck, ShieldX, SquareTerminal, TriangleAlert, Wrench } from '@lucide/svelte';
  import type { PermissionRequest, RequestId } from '@boite/contracts';
  import { verdictWord } from '../lib/verdict-word';
  import { fill, strings } from '../lib/strings';
  import { elapsed } from '../lib/format';
  import { agentSummary, compactionMark, compactionText, familyOf, liveLabel, pairPermissions, runSpan, runSummary, thinkingShown, ThoughtTitleScan, type ActivityPart, type CompactionPart, type PermissionStep, type ThinkingStep, type ToolPart } from '../lib/tool-groups';
  import Deferred from './Deferred.svelte';
  import { permissionCard } from '../lib/idle-parts';
  import ThinkingPart from './ThinkingPart.svelte';
  import ToolCard from './ToolCard.svelte';
  import Spinner from './Spinner.svelte';
  import type { Store } from '../lib/store.svelte';
  import { lastHeard, machineAway } from '../lib/machine-away';
  import type { Snippet } from 'svelte';
  import type { ToolDisclosure } from '../lib/store/deferred-parts';
  import { textRevision } from '../lib/text-revisions';

  /*
   * A run of activity with no answer between it: calls and the reasoning around
   * them. One visible step is drawn as itself; more fold under one line, "Ran 3
   * commands and read 2 files" with the time the run took once it is done, or
   * the agent's own summary of those calls when it wrote one ("Read rules.md and
   * data.txt"); the running step's own words ("Running git", the thought it is
   * on) while one runs. The fold opens on the steps, each one the same line it
   * would be alone. Reasoning with no words that took under a second is not
   * drawn at all. A permission the agent asked is one thing with its call:
   * while it waits, its command row stands for the call under the run, with
   * Deny and Allow once at its end; once answered,
   * the call's line carries the answer as a shield.
   */
  let {
    parts,
    compactions = [],
    thinkingLive = false,
    isBackground,
    loadOutput,
    acquireOutput,
    permissionRequest = () => null,
    answerPermission = () => false,
    store,
    threadId,
    carded = null,
    changes
  }: {
    parts: ActivityPart[];
    /** The compactions that fell in this run: a mark on its line, no row of their own. */
    compactions?: CompactionPart[];
    /** The run's last step is reasoning that is still being written. */
    thinkingLive?: boolean;
    /** Whether the work a call started still runs in the background. */
    isBackground: (toolId: string) => boolean;
    loadOutput?: (toolId: string) => Promise<void>;
    acquireOutput?: (toolId: string) => ToolDisclosure;
    /** What a permission asked, for its card: null once the record is gone. */
    permissionRequest?: (requestId: RequestId) => PermissionRequest | null;
    /** Sends the user's answer to a permission; false gives its buttons back. */
    answerPermission?: (requestId: RequestId, decision: 'allow' | 'deny') => unknown;
    /** The machine and thread the run belongs to, where a thread link in it starts from. */
    store?: Store;
    threadId?: string;
    /** The failed call the turn's error card says: no second red mark for it here (`cardedCall`). */
    carded?: string | null;
    /** The turn's change count when its last change is in this run: on the run's line, or under a lone step. */
    changes?: Snippet<[inline: boolean]>;
  } = $props();

  const ICONS = { command: SquareTerminal, read: FileText, edit: FilePen, write: FilePen, search: Search, fetch: Globe, web: Globe, agent: Bot, other: Wrench };

  const isLive = (index: number) => thinkingLive && index === parts.length - 1;
  let pairs = $derived(pairPermissions(parts));
  /** The permission each paired call was asked under, by the call's index. */
  let asked = $derived(new Map([...pairs].map(([at, call]) => [call, parts[at] as PermissionStep])));
  /** Waiting permissions: each one's command row stands for its call, under the run, with Deny and Allow once. */
  let waiting = $derived(parts.filter((part): part is PermissionStep => part.type === 'permission' && part.decision === null));
  let steps = $derived(parts.flatMap((part, index): { part: ActivityPart; index: number }[] => {
    if (part.type === 'permission') return part.decision !== null && !pairs.has(index) ? [{ part, index }] : [];
    if (part.type === 'tool') return asked.get(index)?.decision === null ? [] : [{ part, index }];
    return thinkingShown(part, isLive(index)) ? [{ part, index }] : [];
  }));
  /** The run's answers on its folded line: a cross when the user refused any call. */
  let verdict = $derived.by((): 'allow' | 'deny' | null => {
    const decisions = [...asked.values()].map((permission) => permission.decision);
    return decisions.includes('deny') ? 'deny' : decisions.includes('allow') ? 'allow' : null;
  });
  let tools = $derived(parts.filter((part): part is ToolPart => part.type === 'tool'));

  let open = $state(false);
  let running = $derived(tools.findLast((part) => part.status === 'running'));
  let thinking = $derived(running === undefined && thinkingLive);
  /** Its machine is out of reach: a running step is the last state known, drawn still. */
  let away = $derived(!!store && machineAway(store));
  let live = $derived((running !== undefined || thinking) && !away);
  let issues = $derived(tools.filter(part => (part.status === 'error' || part.status === 'denied') && part.toolId !== carded).length);
  let said = $derived(verdict === 'allow' ? strings.chat.permissionAllowedBy : verdict === 'deny' ? strings.chat.permissionDeniedBy : null);
  let issueLabel = $derived(fill(issues === 1 ? strings.chat.toolIssueOne : strings.chat.toolIssueMany, { count: String(issues) }));
  // Live, the thought being written; otherwise the last one that has words.
  let thought = $derived(thinking ? parts.at(-1) as ThinkingStep : parts.findLast((part): part is ThinkingStep => part.type === 'thinking' && part.text.trim() !== ''));
  // A text that does not extend the last one starts the scan over: another thought needs no reset.
  const titles = new ThoughtTitleScan();
  let label = $derived(running ? liveLabel(running) : thinking || tools.length === 0 ? titles.title(thought?.text ?? '') ?? strings.chat.thinking : agentSummary(tools) ?? runSummary(tools));
  let Glyph = $derived(running ? ICONS[familyOf(running)] : thinking || tools.length === 0 ? Brain : ICONS[familyOf(tools.at(-1)!)]);
  let busy = $derived(tools.some((part) => isBackground(part.toolId)));

  // The run's clock: it ticks while a step runs and stops on the last finish.
  // Only a group of two steps or more shows it.
  let took = $derived.by(() => {
    const span = runSpan(parts);
    if (!span) return '';
    const ms = (live ? secondClock.now : running && away ? lastHeard(store?.openThread) ?? span.end : span.end) - span.start;
    return live || ms >= 1000 ? elapsed(ms) : '';
  });

  // Built on the first open, then folded both ways like a single call's body.
  let built = $state(false);
  $effect(() => {
    if (open) built = true;
  });
</script>


{#snippet step(part: ActivityPart, index: number, nested = false)}
  {#if part.type === 'permission'}
    {@render ask(part)}
  {:else if part.type === 'thinking'}
    <ThinkingPart text={part.text} revision={textRevision(part)} live={isLive(index)} startedAt={part.startedAt ?? null} finishedAt={part.finishedAt ?? null} {store} {threadId} />
  {:else}
    <ToolCard
      name={part.name}
      input={part.input}
      inputText={part.inputText}
      output={part.output}
      outputDeferred={part.outputDeferred ?? false}
      inputDeferred={part.inputDeferred ?? false}
      documentsDeferred={part.documentsDeferred ?? false}
      loadOutput={loadOutput ? () => loadOutput!(part.toolId) : undefined}
      acquireOutput={acquireOutput ? () => acquireOutput!(part.toolId) : undefined}
      status={part.status}
      exitCode={part.exitCode}
      documents={part.documents ?? []}
      startedAt={part.startedAt ?? null}
      finishedAt={part.finishedAt ?? null}
      background={isBackground(part.toolId)}
      permission={asked.get(index)?.decision ?? null}
      carded={part.toolId === carded}
      {nested}
      folded={nested && !open}
      {store}
      {threadId}
    />
  {/if}
{/snippet}

{#snippet ask(part: PermissionStep)}
  <Deferred part={permissionCard}>{#snippet children(PermissionCard)}<PermissionCard
    toolName={part.toolName}
    decision={part.decision}
    request={permissionRequest(part.requestId)}
    answer={(decision) => answerPermission(part.requestId, decision)}
  />{/snippet}</Deferred>
{/snippet}

{#if steps.length === 1 && steps[0] && compactions.length === 0}
  {@render step(steps[0].part, steps[0].index)}
  {@render changes?.(false)}
{:else if steps.length > 0}
  <div class="group" data-testid="tool-group" data-count={steps.length} data-live={live}>
    <!-- The run's line, and the turn's change count on it when its last change is here: one row, not a card under it. -->
    <div class="line" class:counted={!!changes}>
    <button
      type="button"
      class="ghost head"
      data-testid="tool-group-toggle"
      aria-expanded={open}
      title={open ? strings.chat.toolRunHide : strings.chat.toolRunShow}
      aria-label={said || issues || compactions.length ? [label, ...compactions.map(compactionText), said, issues ? issueLabel : null].filter(Boolean).join(', ') : undefined}
      onclick={() => (open = !open)}
    >
      <span class="glyph"><Glyph size={15} strokeWidth={1.75} /></span>
      <span class="label ui-label" class:shimmer={live} data-testid="tool-group-label" title={label}>{label}</span>
      {#if took}<span class="took ui-label" class:settled={!live} data-testid="tool-group-elapsed">{took}</span>{/if}
      {#each compactions as part, at (at)}
        <span class="compacted ui-label" data-testid="tool-group-compaction" title={compactionText(part)}><FoldVertical size={12} strokeWidth={1.75} aria-hidden="true" />{compactionMark(part)}</span>
      {/each}
      {#if busy}
        <span class="pulse" aria-hidden="true"></span>
      {/if}
      {#if running}
        <Spinner size={11} stale={away} label={away ? strings.chat.toolPaused : undefined} />
      {/if}
      {#if verdict}
        <span class="verdict" class:denied={verdict === 'deny'} data-testid="tool-group-permission" data-decision={verdict} title={said} aria-label={said}>
          {#if verdict === 'allow'}<ShieldCheck size={13} strokeWidth={2} />{:else}<ShieldX size={13} strokeWidth={2} />{/if}<span class="ui-label verdict-word">{verdictWord(verdict)}</span>
        </span>
      {/if}
      {#if issues}
        <span class="status" data-testid="tool-group-issues" title={issueLabel}><TriangleAlert size={12} strokeWidth={1.75} /><span class="ui-label">{issues}</span></span>
      {/if}
      <span class="fold-caret" class:open aria-hidden="true"><ChevronRight size={12} /></span>
    </button>
    {@render changes?.(true)}
    </div>
    <div class="disclosure-fold" class:open inert={!open}>
      <div>
        {#if built}
          <div class="calls">
            {#each steps as { part, index } (part.type === 'tool' ? part.toolId : `thinking-${index}`)}
              {@render step(part, index, true)}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
{#each waiting as part (part.requestId)}
  <div class="waiting" class:after={steps.length > 0}>{@render ask(part)}</div>
{/each}

<style>
  .group {
    max-width: 100%;
    min-width: 0;
  }

  /* With the change count on it, the count and its diff close the line, its
     list and diffs open under it. A phone gives the words the whole width and
     the count the next line. */
  .line.counted { display: flex; flex-wrap: wrap; align-items: center; column-gap: 2px; }
  .counted > .head { flex: 1 1 0; width: auto; min-width: 0; }
  @media (max-width: 720px) { .counted > .head { flex-basis: 100%; } }

  .head {
    display: flex;
    align-items: center;
    gap: var(--activity-gap);
    width: 100%;
    min-height: var(--control);
    height: auto;
    padding: var(--activity-padding);
    border-radius: var(--radius-sm);
    color: var(--instrument-ink);
    font-size: var(--instrument-size);
    line-height: var(--instrument-leading);
    font-weight: 400;
    /* No body tracking on the run's line: where glyphs land on whole pixels (Chrome on Linux), the
       -0.006em drift rounds a pixel out of a space every few glyphs ("Ran 1 command" shows as "Ran 1command"). */
    letter-spacing: normal;
    justify-content: flex-start;
  }

  .head:hover:not(:disabled) {
    background: var(--color-surface-2);
    color: var(--color-foreground);
  }

  .head:active:not(:disabled) {
    transform: none;
    background: var(--color-surface-3);
  }

  .glyph {
    display: inline-flex;
    flex: none;
    width: var(--activity-glyph);
    justify-content: center;
    color: var(--color-subtle);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: none;
    color: var(--instrument-meta);
    font-size: var(--instrument-meta-size);
  }

  .verdict {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    color: var(--color-success);
  }
  /* The verdict's word, the receipt's own, beside the shield. */
  .verdict-word { font-size: var(--instrument-meta-size); }

  .verdict.denied { color: var(--color-danger); }

  .waiting.after { margin-top: var(--chat-part-gap); }

  .label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  /* A light passing over the words while a call runs. It moves in 33 steps a
     sweep, one every fourth tick of the loops' 60 Hz grid (app.css): the text
     clipped gradient repaints on each step, not on every frame. */
  .label.shimmer {
    background: linear-gradient(90deg, var(--instrument-ink) 35%, var(--color-foreground) 50%, var(--instrument-ink) 65%) 0 0 / 300% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: shimmer 2.2s steps(33) infinite var(--loops);
  }

  @keyframes shimmer {
    from { background-position: 100% 0; }
    to { background-position: 0 0; }
  }

  .compacted { flex: none; display: inline-flex; align-items: center; gap: 4px; color: var(--instrument-meta); font-size: var(--instrument-meta-size); }
  .took {
    flex: none;
    color: var(--instrument-meta);
    font-size: var(--instrument-meta-size);
    font-variant-numeric: tabular-nums;
  }

  /* A finished run's time is read on demand: under the pointer, the keyboard or an open run. */
  .took.settled { opacity: 0; transition: opacity var(--dur-2); }
  .head:hover .took.settled, .head:focus-visible .took.settled, .head[aria-expanded='true'] .took.settled { opacity: 1; }

  /* A phone reads the run's line whole: a settled summary fills the width,
     then wraps rather than ends in an ellipsis, and its time, which no pointer can bring up there,
     leaves the line its width until the run is opened. */
  @media (max-width: 720px) {
    .label:not(.shimmer) { white-space: normal; overflow-wrap: anywhere; }
  }
  @media (hover: none) {
    .head[aria-expanded='false'] .took.settled { display: none; }
  }

  .pulse {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-accent);
    animation: pulse 1.6s var(--loop-ease-out-quint-48) infinite var(--loops);
  }

  /* The calls hang off a hairline under the summary's glyph. */
  .calls {
    display: flex;
    flex-direction: column;
    gap: var(--chat-part-gap);
    margin: 4px 0 8px calc(var(--activity-padding) + var(--activity-glyph) / 2);
    padding-left: var(--activity-gap);
    border-left: 1px solid var(--color-border);
  }

  @media (prefers-reduced-motion: reduce) { :is(.pulse, .label.shimmer) { animation: none; } .label.shimmer { color: var(--instrument-ink); background: none; } }
  :global(html[data-motion='reduced']) :is(.pulse, .label.shimmer) { animation: none; }
  :global(html[data-motion='reduced']) .label.shimmer { color: var(--instrument-ink); background: none; }
</style>
