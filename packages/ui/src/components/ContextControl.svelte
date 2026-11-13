<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Clock } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { effectiveCompaction, threadActive } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import { contextPercent, contextLevel } from '../lib/tokens';
  import { Closing } from '../lib/closing.svelte';
  import { contextPopup } from '../lib/idle-parts';
  import { experimentOn } from '../lib/experiments.svelte';
  import { cacheSpan, promptCacheState, PROMPT_CACHE_TICK_MS } from '../lib/prompt-cache';
  /**
   * The context's one form, desktop and phone: a small ring filled by what is
   * used and the words "28% context left", a quiet item of the composer's row (drawn
   * from its threshold, `ComposerBar`). A hover or a click opens the details.
   */
  let { store }: { store: Store } = $props();
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
  const left = $derived(percent === null ? null : 100 - Math.round(percent));
  /** The meter's name with its number, said on hover and to screen readers: a bare percent names nothing. */
  const named = $derived(left === null ? strings.thread.contextDetails : strings.thread.contextLeftNamed(String(left)));
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
<div class="context" bind:this={root} data-testid="context-meter" data-percent={percent ?? ''} data-level={contextLevel(percent)} onmouseenter={show} onmouseleave={hideLater} onfocusin={show} onfocusout={hideLater}>
  <button type="button" class="trigger ghost" data-testid="context-trigger" title={named} aria-label={[named, cacheLabel].filter(Boolean).join(', ')} aria-expanded={popup.open} aria-haspopup="dialog" onclick={show}>
    <!-- A still ring filled by the share used, grey like the words, never the accent of a spinner. -->
    <svg class="ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle class="track" cx="7" cy="7" r="5.25" /><circle class="used" cx="7" cy="7" r="5.25" pathLength="100" stroke-dasharray="{percent ?? 0} 100" /></svg>
    {#if left !== null}<span class="percent ui-label" aria-hidden="true">{strings.thread.contextLeft(String(left))}</span>{/if}
    {#if cacheNow}
      <span class="cache-chip num" data-testid="prompt-cache" data-state={cacheNow.kind} class:low={cacheNow.kind !== 'cold' && cacheNow.secondsLeft <= 300} aria-hidden="true">
        <Clock size={13} strokeWidth={1.75} /><span class="ui-label">{cacheNow.kind === 'cold' ? strings.thread.cacheCold : remaining(cacheNow.secondsLeft)}</span>
      </span>
    {/if}
  </button>
  {#if popup.shown && contextPopup.current}
    <contextPopup.current {store} {popup} target={() => root ?? null} {percent} {autoCompact} {cache} {cacheNow} {remaining} bind:readingExpanded onshape={showShape} />
  {/if}
</div>
{#if shapeOf && ShapeDialog}<ShapeDialog {store} threadId={shapeOf} onclose={() => { shapeOf = null; }} />{/if}

<style>
  /* Figures in the sans, on even columns: mono is for code only. */
  .num { font-variant-numeric: tabular-nums; }
  .context { position: relative; flex: none; color: var(--color-muted-foreground); }
  .trigger { display: flex; align-items: center; gap: 5px; height: var(--control-sm); padding: 0 8px; border-radius: var(--radius-md); color: inherit; }
  @media (max-width: 720px) { .trigger { min-height: var(--touch-target); padding: 0 6px; } }
  /* The ring and the words in neutral ink, grey however full until the window
     is nearly spent (90%), then the caution ink: never the accent, never a warning early. */
  .ring { flex: none; transform: rotate(-90deg); }
  .ring circle { fill: none; stroke: currentColor; stroke-width: 2; }
  .ring .track { opacity: .28; }
  .ring .used { stroke-linecap: round; }
  .percent { font-size: var(--text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
  [data-level='full'] .trigger { color: var(--color-caution); }
  .cache-chip { display: flex; align-items: center; gap: 3px; margin-left: 4px; font-size: var(--text-xs); }
  .cache-chip[data-state='warm'] :global(svg) { color: var(--color-success); }
  .cache-chip[data-state='maybe'] :global(svg), .cache-chip.low :global(svg) { color: var(--color-caution); }
</style>
