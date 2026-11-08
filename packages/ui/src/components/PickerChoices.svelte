<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte';

  /**
   * A setting of the model picker as one row (effort, speed, permissions).
   * Short choices (a level, a speed) are a segmented row under the setting's
   * name: every choice in view, one tap, no list folded inside the popover,
   * on a desktop and a phone alike (a phone's segments are a finger tall and
   * a two-word level takes a second line rather than losing its end). Long
   * ones (a permission in words) keep the fold: the current choice at the
   * row's end unfolds them one per row, a check on the picked one. In either
   * form the arrows walk and pick like a radio group; a click picks (and
   * folds); Escape folds.
   */
  let { label, items, active, onpick, testid, segmented }: {
    label: string;
    items: { id: string; label: string; title?: string }[];
    active: string | null;
    onpick: (id: string) => void;
    testid: string;
    /** Forces one form; by default the choices are segmented when every label is short enough to share a row. */
    segmented?: boolean;
  } = $props();

  /** A segment holds a word or two: past this many letters, or this many choices, a row of them would cut a label at 360 px. */
  const SEGMENT_CHARS = 10;
  const SEGMENT_MAX = 7;
  let flat = $derived(segmented ?? (items.length > 1 && items.length <= SEGMENT_MAX && items.every((item) => item.label.length <= SEGMENT_CHARS)));

  let open = $state(false);
  let group = $state<HTMLDivElement | undefined>(undefined);
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
  /** The one the keyboard lands on: the active choice, or the first while none is. */
  let home = $derived(items.some((item) => item.id === active) ? active : items[0]?.id ?? null);
  let current = $derived(items.find((item) => item.id === active));

  function unfold() {
    open = true;
    queueMicrotask(() => group?.querySelector<HTMLElement>('[role=radio][tabindex="0"]')?.focus());
  }
  function fold() {
    open = false;
    trigger?.focus();
  }

  /** Up and down cross the picker's rows, the models and the other settings included, as `pickerKeydown` does. */
  function walk(step: number) {
    const menu = trigger?.closest('[data-testid=composer-picker-menu]');
    const rows = Array.from(menu?.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)') ?? []);
    const here = trigger ? rows.indexOf(trigger) : -1;
    rows[(here + step + rows.length) % rows.length]?.focus();
  }

  function onTriggerKey(event: KeyboardEvent) {
    if (event.key === 'ArrowRight' || (event.key === 'ArrowLeft' && open)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowRight') unfold(); else fold();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      walk(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      fold();
    }
  }

  function onListKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return fold();
    }
    // Every arrow walks the choices, as in a radio group: left and right still step a level down and up.
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const here = items.findIndex((item) => item.id === (document.activeElement as HTMLElement | null)?.dataset.value);
    const next = items[(Math.max(0, here) + step + items.length) % items.length];
    if (!next) return;
    onpick(next.id);
    group?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.id)}"]`)?.focus();
  }

  function choose(id: string) {
    if (id !== active) onpick(id);
    if (!flat) fold();
  }

  /** The segments: left and right pick like a radio group, up and down leave for the picker's other rows. */
  function onSegmentsKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const menu = group?.closest('[data-testid=composer-picker-menu]');
      const rows = Array.from(menu?.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)') ?? []);
      const here = rows.indexOf(document.activeElement as HTMLElement);
      rows[(here + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') onListKey(event);
  }
</script>

{#if flat}
<div class="segments" role="radiogroup" tabindex="-1" aria-label={label} data-testid={testid} bind:this={group} onkeydown={onSegmentsKey}>
  {#each items as item (item.id)}
    <!-- The live choice is the picker's row for the keys: up and down stop on it once, not on every segment. -->
    <button type="button" class="segment" class:on={item.id === active} role="radio" aria-checked={item.id === active} tabindex={item.id === home ? 0 : -1}
      data-row={item.id === home ? '' : undefined} data-value={item.id} title={item.title} onclick={() => choose(item.id)}>
      <span class="ui-label">{item.label}</span>
    </button>
  {/each}
</div>
{:else}
<span class="picker-choices">
  <button type="button" class="ghost current" data-row data-choices-trigger aria-expanded={open} aria-label={`${label}: ${current?.label ?? ''}`}
    title={current?.title} bind:this={trigger} onclick={() => (open ? fold() : unfold())} onkeydown={onTriggerKey}>
    <span class="value ui-label">{current?.label ?? ''}</span>
    <ChevronDown size={14} strokeWidth={2} />
  </button>
  <div class="list" role="radiogroup" tabindex="-1" aria-label={label} data-testid={testid} hidden={!open} bind:this={group} onkeydown={onListKey}>
    {#each items as item (item.id)}
      <button type="button" class="choice" role="radio" aria-checked={item.id === active} tabindex={item.id === home ? 0 : -1}
        data-value={item.id} title={item.title} onclick={() => choose(item.id)}>
        <span class="mark" aria-hidden="true">{#if item.id === active}<Check size={14} strokeWidth={2.25} />{/if}</span>
        <span class="ui-label">{item.label}</span>
      </button>
    {/each}
  </div>
</span>
{/if}

<style>
  /* Its parts sit in the setting's own row: the current value at its end, the list on a row of its own under it. */
  .picker-choices { display: contents; }
  .current { display: inline-flex; flex: 1 1 auto; justify-content: flex-end; align-items: center; gap: 6px; min-width: 0; min-height: var(--control-sm); padding: 0 6px 0 10px; border-radius: var(--radius-sm); color: var(--color-foreground); font-size: var(--text-sm); font-weight: 500; text-align: right; }
  .current .value { min-width: 0; white-space: normal; }
  .current :global(svg) { flex: none; color: var(--color-muted-foreground); transition: transform var(--dur-2) var(--ease-out-quint); }
  .current[aria-expanded='true'] :global(svg) { transform: rotate(180deg); }
  .list { display: flex; flex: 1 0 100%; flex-direction: column; gap: 1px; padding: 2px 0 4px; animation: rise var(--dur-2) var(--ease-out-quint); }
  .list[hidden] { display: none; }
  .choice { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; min-height: var(--row); padding: 4px 10px 4px 6px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; text-align: left; box-shadow: none; }
  @media (hover: hover) { .choice:hover { background: var(--color-hover); color: var(--color-foreground); } }
  .choice[aria-checked='true'] { color: var(--color-foreground); font-weight: 500; }
  .mark { display: inline-flex; flex: none; width: 14px; color: var(--color-accent); }
  /* Under the setting's name, the full width of the row: the same track as the settings' segmented switches. */
  .segments { display: flex; flex: 1 0 100%; gap: 2px; padding: 2px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-frame); }
  .segment { flex: 1 1 auto; min-width: 0; height: var(--control-sm); padding: 0 6px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 500; box-shadow: none; }
  /* A label longer than its share takes a second line rather than losing its end. */
  .segment .ui-label { white-space: normal; text-align: center; line-height: 1.15; }
  .segment.on { background: var(--color-surface-3); border-color: var(--color-edge); color: var(--color-foreground); box-shadow: var(--shadow-e1); }
  .segment:active:not(:disabled) { transform: none; }
  @media (hover: hover) { .segment:hover:not(.on) { background: var(--color-surface-3); color: var(--color-foreground); } }
  @media (max-width: 720px) {
    .current { min-height: var(--touch-target); }
    .choice { min-height: var(--touch-target); }
    /* A finger wide too: at 360 px a short word (Low, Max) left its segment at 42 px. */
    .segment { height: auto; min-width: var(--touch-target); min-height: var(--touch-target); }
  }
</style>
