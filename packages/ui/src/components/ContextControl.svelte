<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ChartPie, Clock } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { effectiveCompaction, threadActive } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import { contextPercent, contextLevel } from '../lib/tokens';
  import { Closing } from '../lib/closing.svelte';
  import { contextPopup } from '../lib/composer-dock';
  import { experimentOn } from '../lib/experiments.svelte';
  import { cacheSpan, promptCacheState, PROMPT_CACHE_TICK_MS } from '../lib/prompt-cache';
  let { store, anchor, quiet = false }: {
    store: Store;
    /** What the popup opens above: the meter, or the composer while an ask is docked in it. */
    anchor?: () => HTMLElement | null;
    /** Under the threshold the row shows nothing: no trigger is drawn, the popup still opens through `open()`. */
    quiet?: boolean;
  } = $props();
  let root = $state<HTMLDivElement>();
  const popup = new Closing();
  let readingExpanded = $state(false);
  $effect(() => { if (!popup.open) readingExpanded = false; });
  let leave: ReturnType<typeof setTimeout> | undefined;
  const thread = $derived(store.openThread);
  const context = $derived(thread?.context ?? null);
  const autoCompact = $derived(store.settings && thread ? effectiveCompaction(store.settings, thread).autoCompact : null);
  const percent = $derived(context ? contextPercent(context, autoCompact) : null);
  /** The thread whose last request is shown; it stays the one opened even if the user navigates. */
  let shapeOf = $state<string | null>(null);
  /** Loaded on first use: the view stays out of the startup chunk. */
  let ShapeDialog = $state.raw<typeof import('./AgentShapeDialog.svelte').default | null>(null);
  function showShape() {
    if (!thread) return;
    const id = thread.id;
    popup.hide();
    // Offline, or after an update removed the old chunk, the dialog cannot load: say so.
    void import('./AgentShapeDialog.svelte').then(module => { ShapeDialog = module.default; shapeOf = id; })
      .catch((error: unknown) => store.reportError(error, 'minor'));
  }
  // A running turn may refresh the cache. Hide the old timer until it finishes.
  let now = $state(Date.now());
  const activeTurn = $derived(thread ? threadActive(thread.status) : false);
  const cache = $derived(experimentOn('prompt-cache') && !activeTurn ? thread?.promptCache ?? null : null);
  const cacheNow = $derived(cache && thread ? promptCacheState(cache, thread, now) : null);
  $effect(() => {
    if (!cache) return;
    now = Date.now();
    const tick = setInterval(() => { now = Date.now(); }, PROMPT_CACHE_TICK_MS);
    return () => clearInterval(tick);
  });
  const remaining = (seconds: number) => { const span = cacheSpan(seconds); return span.unit === 'hours' ? strings.thread.hours(span.n) : strings.thread.minutes(span.n); };
  const cacheLabel = $derived(!cacheNow ? null : cacheNow.kind === 'cold' ? strings.thread.cacheChipCold
    : cacheNow.kind === 'maybe' ? strings.thread.cacheChipMaybe(remaining(cacheNow.secondsLeft))
    : strings.thread.cacheChipWarm(remaining(cacheNow.secondsLeft)));
  // The details are their own chunk (`ContextPopup`): a hover or a focus fetches them if the idle prefetch did not.
  function show() { clearTimeout(leave); void contextPopup.load().catch((error: unknown) => store.reportError(error, 'minor')); popup.show(); }
  /** Opens the details from elsewhere (the "+" menu), the meter drawn or not. */
  export function open() { show(); }
  /** The meter's name with its number, said on hover and to screen readers: a bare percent names nothing. */
  const named = $derived(percent === null ? strings.thread.contextDetails : strings.thread.contextPercentUsed(String(Math.round(percent))));
  function hideLater() { clearTimeout(leave); leave = setTimeout(() => { if (!root?.contains(document.activeElement)) popup.hide(); }, 180); }
  onDestroy(() => clearTimeout(leave));
  /**
   * Captured on the window, ahead of App's own listener there and of the
   * composer's: the Escape that shuts this popup is spent on it and never
   * also stops the running turn.
   */
  function closeOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !popup.open) return;
    event.preventDefault();
    event.stopPropagation();
    if (readingExpanded) readingExpanded = false;
    else popup.hide();
  }
</script>

<svelte:window onpointerdown={event => { if (event.target instanceof Node && !root?.contains(event.target)) popup.hide(); }} onkeydowncapture={closeOnEscape} />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="context" class:quiet bind:this={root} data-testid={quiet ? 'context-details' : 'context-meter'} data-percent={percent ?? ''} data-level={contextLevel(percent)} onmouseenter={quiet ? undefined : show} onmouseleave={hideLater} onfocusin={show} onfocusout={hideLater}>
  {#if !quiet}
  <button type="button" class="trigger ghost" data-testid="context-trigger" title={named} aria-label={[named, cacheLabel].filter(Boolean).join(', ')} aria-expanded={popup.open} aria-haspopup="dialog" onclick={show}>
    <!-- A number, not an arc that reads as a spinner; before the first reading the meter's glyph stands alone, never a dash. -->
    {#if percent !== null}<ChartPie class="measure" size={13} strokeWidth={1.75} aria-hidden="true" /><span class="percent ui-label" aria-hidden="true">{Math.round(percent)}%<span class="word">{` ${strings.thread.contextWord}`}</span></span>{:else}<ChartPie size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
    {#if cacheNow}
      <span class="cache-chip num" data-testid="prompt-cache" data-state={cacheNow.kind} class:low={cacheNow.kind !== 'cold' && cacheNow.secondsLeft <= 300} aria-hidden="true">
        <Clock size={13} strokeWidth={1.75} /><span class="ui-label">{cacheNow.kind === 'cold' ? strings.thread.cacheCold : remaining(cacheNow.secondsLeft)}</span>
      </span>
    {/if}
  </button>
  {/if}
  {#if popup.shown && contextPopup.current}
    <contextPopup.current {store} {popup} target={() => anchor?.() ?? root ?? null} sheet={anchor?.() && !quiet ? false : undefined} {percent} {autoCompact} {cache} {cacheNow} {remaining} bind:readingExpanded onshape={showShape} />
  {/if}
</div>
{#if shapeOf && ShapeDialog}<ShapeDialog {store} threadId={shapeOf} onclose={() => { shapeOf = null; }} />{/if}

<style>
  /* Figures in the sans, on even columns: mono is for code only. */
  .num { font-variant-numeric: tabular-nums; }
  .context { position: relative; flex: none; color: var(--color-muted-foreground); }
  .trigger { display: flex; align-items: center; gap: 5px; padding: 4px; }
  @media (max-width: 720px) { .trigger { min-width: var(--touch-target); min-height: var(--touch-target); justify-content: center; } }
  /* The number alone in neutral ink; it warms only as the window fills. */
  .quiet { display: contents; }
  .percent { font-size: var(--text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* The percent names its measure: the word on a desktop; on a phone, where the model's name needs the row, the meter's glyph. */
  .trigger :global(.measure) { display: none; }
  @media (max-width: 720px) { .trigger :global(.measure) { display: block; } .word { display: none; } }
  [data-level='high'] :is(.percent, .trigger :global(.measure)) { color: var(--color-live); }
  [data-level='full'] :is(.percent, .trigger :global(.measure)) { color: var(--color-danger); }
  .cache-chip { display: flex; align-items: center; gap: 3px; margin-left: 4px; font-size: var(--text-xs); }
  .cache-chip[data-state='warm'] :global(svg) { color: var(--color-success); }
  .cache-chip[data-state='maybe'] :global(svg), .cache-chip.low :global(svg) { color: var(--color-live); }
</style>
