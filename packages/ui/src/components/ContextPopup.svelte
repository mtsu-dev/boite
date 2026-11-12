<script lang="ts">
  import { Info, Minimize2, ScanEye } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import type { AutoCompact, ThreadCapabilities, ThreadStats } from '@boite/contracts';
  import { fill, strings } from '../lib/strings';
  import { contextLimit } from '../lib/tokens';
  import { count, time } from '../lib/format';
  import type { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import type { promptCacheState } from '../lib/prompt-cache';

  /**
   * The context meter's details: the reading, its parts, the thread's counts,
   * Compact and the prompt cache. Its own chunk, fetched at idle
   * (`lib/idle-parts.ts`): a hover or a click opens it, the first screen
   * never draws it. `ContextControl` keeps the meter, the open state and
   * Escape.
   */
  let { store, popup, target, percent, autoCompact, cache, cacheNow, remaining, readingExpanded = $bindable(false), onshape }: {
    store: Store;
    popup: Closing;
    /** What the popup opens above. */
    target: () => HTMLElement | null;
    percent: number | null;
    autoCompact: AutoCompact | null;
    cache: NonNullable<Store['openThread']>['promptCache'] | null;
    cacheNow: ReturnType<typeof promptCacheState> | null;
    remaining: (seconds: number) => string;
    readingExpanded?: boolean;
    onshape: () => void;
  } = $props();
  let submitting = $state(false);
  const readingId = $props.id();
  const thread = $derived(store.openThread);
  const context = $derived(thread?.context ?? null);
  const modelWindow = $derived(context ? contextLimit(context) : null);
  const limit = $derived(context ? contextLimit(context, autoCompact) : null);
  const compactLimit = $derived(limit !== null && (modelWindow === null || limit < modelWindow));
  const protocol = $derived(thread ? store.providerOf(thread.providerId)?.protocol : null);
  let capabilities = $state<ThreadCapabilities | null>(null);
  let capabilityFailed = $state(false);
  let capabilityPending = $state(false);
  $effect(() => {
    const id = thread?.id;
    const revision = thread?.selectionVersion;
    const status = thread?.status;
    const session = thread?.sessionId;
    const commands = thread?.commands;
    // Recheck controls only while their menu is visible, on a new runtime state.
    void revision; void status; void session; void commands;
    capabilities = null;
    capabilityFailed = false;
    capabilityPending = false;
    if (!popup.open || !id || store.connection !== 'ready') return;
    capabilityPending = true;
    let current = true;
    void store.threadCapabilities(id).then(value => { if (current) capabilities = value; })
      .catch(() => { if (current) capabilityFailed = true; })
      .finally(() => { if (current) capabilityPending = false; });
    return () => { current = false; };
  });
  /** The whole thread's compactions and prompts, read while the popup is open and again after each turn. */
  let stats = $state<ThreadStats | null>(null);
  $effect(() => {
    const id = thread?.id;
    const status = thread?.status;
    void status;
    stats = null;
    if (!popup.open || !id || store.connection !== 'ready') return;
    let current = true;
    // A core without the method answers null; a failed read leaves the lines out, the popup still works.
    void store.threadStats(id).then(value => { if (current) stats = value; }).catch(() => {});
    return () => { current = false; };
  });
  const supported = $derived(protocol !== 'acp' || thread?.commands?.some(command => command.name === 'compact'));
  const reason = $derived(submitting || store.busy ? strings.composer.compactBusy : !thread?.sessionId
    ? strings.composer.compactNoSession : capabilityPending ? strings.app.loading
    : store.connection !== 'ready' || capabilityFailed || (capabilities ? !capabilities.compaction.available : !supported) ? strings.composer.compactUnavailable : null);
  const exact = (n: number) => count(n);
  const segments = $derived(context?.breakdown ? [
    {name: strings.thread.contextInput, count: context.breakdown.input, kind: 'input'},
    {name: strings.thread.contextCache, count: context.breakdown.cache, kind: 'cache'},
    {name: strings.thread.contextOutput, count: context.breakdown.output, kind: 'output'}
  ] : [{name: strings.thread.contextUsed, count: context?.tokens ?? 0, kind: 'input'}]);
  const lifetime = (seconds: number) => seconds % 3600 === 0 ? strings.thread.hours(seconds / 3600) : strings.thread.minutes(Math.round(seconds / 60));
  async function compact() {
    if (reason || submitting) return;
    submitting = true;
    try { await store.compact(); popup.hide(); } finally { submitting = false; }
  }
</script>

<div class="popup" class:closing={popup.closing} role="dialog" aria-label={strings.thread.contextDetails} tabindex="-1" data-testid="context-popup" use:popup.attach onanimationend={popup.end}
  use:floating={{ anchor: target, placement: 'top', align: 'end', cap: Infinity, dismiss: () => popup.hide() }}>
  <div class="heading"><span class="title">{strings.thread.contextDetails}
    {#if context}<button type="button" class="reading-info ghost icon" data-testid="context-info" aria-label={fill(strings.common.moreInfo, { topic: strings.thread.contextDetails })} aria-expanded={readingExpanded} aria-controls={readingId} onclick={() => { readingExpanded = !readingExpanded; }}><Info size={14} /></button>{/if}
  </span>{#if percent !== null}<span class="num">{percent}%</span>{/if}</div>
  {#if context}
    <p class="total"><span class="num">{exact(context.tokens)}{#if limit !== null}{' / '}{exact(limit)}{/if}</span> <span class="unit">{strings.thread.contextTokens}</span></p>
    <div class="bar" aria-hidden="true">
      {#each segments as segment (segment.kind)}<span class={segment.kind} style:width={`${Math.min(100, segment.count / Math.max(1, limit ?? context.tokens) * 100)}%`}></span>{/each}
    </div>
    {#if limit !== null}<p class="remaining" data-testid="context-remaining">{compactLimit ? strings.thread.contextRemainingCompact(exact(Math.max(0, limit - context.tokens))) : strings.thread.contextRemaining(exact(Math.max(0, limit - context.tokens)))}</p>{/if}
    <div id={readingId} class="reading-detail" hidden={!readingExpanded}>
      {#if compactLimit}<p class="note" data-testid="context-auto-compact">{modelWindow !== null ? strings.thread.contextAutoCompactWindow(exact(modelWindow)) : strings.thread.contextAutoCompact}</p>{/if}
      {#if context.breakdown}
        <dl>{#each segments as segment (segment.kind)}<div><dt><i class={segment.kind}></i>{segment.name}</dt><dd class="num">{exact(segment.count)}</dd></div>{/each}</dl>
      {:else}<p class="note">{strings.thread.contextNoBreakdown}</p>{/if}
      <p class="note">{strings.thread.contextMeasured} · {time(context.at)}</p>
    </div>
  {:else}<p class="note">{strings.thread.contextNoReading}</p>{/if}
  {#if stats}
    <dl class="stats" data-testid="context-stats">
      <div data-testid="context-compactions"><dt>{strings.thread.contextCompactions}</dt><dd class="num">{exact(stats.compactions)}</dd></div>
      <div data-testid="context-prompts"><dt>{strings.thread.contextPrompts}</dt><dd class="num">{exact(stats.prompts)}</dd></div>
    </dl>
  {/if}
  <button type="button" class="compact" data-testid="context-compact" disabled={reason !== null} title={reason ?? strings.composer.compact} onclick={() => void compact()}><Minimize2 size={14} /><span class="ui-label">{strings.composer.compact}</span></button>
  {#if reason}<p class="note">{reason}</p>{/if}
  {#if protocol === 'claude-sdk'}
    <button type="button" class="shape" data-testid="context-agent-shape" onclick={onshape}><ScanEye size={14} /><span class="ui-label">{strings.agentShape.open}</span></button>
  {/if}
  {#if cache && cacheNow}
    <div class="cache-detail" data-testid="prompt-cache-detail">
      <div class="heading"><span>{strings.thread.cacheTitle}</span><span class="num state" data-state={cacheNow.kind}>{cacheNow.kind === 'warm' ? strings.thread.cacheLeft(remaining(cacheNow.secondsLeft))
        : cacheNow.kind === 'maybe' ? strings.thread.cacheMaybe(remaining(cacheNow.secondsLeft)) : strings.thread.cacheCold}</span></div>
      <dl>
        <div><dt>{strings.thread.cacheLifetime}</dt><dd class="num">{cache.maxSeconds !== undefined ? strings.thread.cacheRange(lifetime(cache.ttlSeconds), lifetime(cache.maxSeconds))
          : `${lifetime(cache.ttlSeconds)} · ${cache.source === 'reported' ? strings.thread.cacheSourceReported : strings.thread.cacheSourceDocumented}`}</dd></div>
        {#if cache.readTokens > 0}<div><dt>{strings.thread.cacheReadLast}</dt><dd class="num">{exact(cache.readTokens)}</dd></div>{/if}
      </dl>
      {#if cacheNow.kind === 'cold' && cacheNow.switched}<p class="note">{strings.thread.cacheSwitched}</p>{/if}
    </div>
  {/if}
</div>

<style>
  /* Figures in the sans, on even columns: mono is for code only. */
  .num { font-variant-numeric: tabular-nums; }
  .cache-detail { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--color-border); }
  .cache-detail dl { margin-bottom: 0; }
  .state { font-weight: 400; }
  .state[data-state='warm'] { color: var(--color-success); }
  .state[data-state='maybe'] { color: var(--color-caution); }
  .state[data-state='cold'] { color: var(--color-muted-foreground); }
  .popup { position: fixed; width: min(320px, calc(100vw - 24px)); z-index: 60; padding: 16px; border: 1px solid var(--overlay-edge); border-radius: var(--radius-overlay); background: var(--overlay-surface); box-shadow: var(--shadow-overlay); animation: pop var(--dur-2) var(--ease-out-quint); color: var(--color-foreground); overflow-y: auto; overscroll-behavior: contain; }
  .popup.closing { animation: pop-out var(--dur-2) var(--ease-out-quint); pointer-events: none; }
  .heading { display: flex; justify-content: space-between; font-size: var(--text-sm); font-weight: 600; }
  .title { display: flex; align-items: center; gap: 4px; }
  .reading-info { width: 22px; height: 22px; margin: -2px 0; padding: 0; color: var(--color-muted-foreground); }
  .reading-info[aria-expanded='true'] { color: var(--color-foreground); }
  .total { margin: 8px 0 12px; font-size: var(--text-sm); }
  .unit { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .remaining { margin: 10px 0 0; font-size: var(--text-xs); line-height: 1.5; color: var(--color-muted-foreground); }
  .reading-detail { margin-top: 12px; padding-top: 4px; border-top: 1px solid var(--color-border); }
  .bar { display: flex; height: 7px; overflow: hidden; background: var(--color-border); border-radius: var(--radius-sm); }
  /* The input share in neutral ink: the accent stays on send. */
  .input { background: var(--color-subtle); }
  .cache { background: var(--color-success); }
  /* A series, not a state: amber stays for what needs you. */
  .output { background: var(--series-2); }
  dl { margin: 12px 0; font-size: var(--text-xs); }
  dl div { display: flex; justify-content: space-between; gap: 16px; margin: 6px 0; }
  dt { display: flex; align-items: center; gap: 7px; color: var(--color-muted-foreground); }
  dd { margin: 0; }
  i { width: 7px; height: 7px; border-radius: var(--radius-sm); }
  .note { font-size: var(--text-xs); line-height: 1.5; color: var(--color-muted-foreground); margin: 8px 0 0; }
  .stats { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--color-border); }
  .stats div { margin: 4px 0; }
  .compact, .shape { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin-top: 14px; font-size: var(--text-sm); }
  .shape { margin-top: 8px; }
  @media (max-width: 720px) { .reading-info { width: 30px; height: 30px; margin: -6px -4px; } }
</style>
