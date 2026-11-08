<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte';

  /**
   * A setting of the model picker as one row (effort, speed, permissions): the
   * current choice at its end, which unfolds the choices one per row, a check
   * on the picked one. The same rows on a desktop and a phone, never a grid.
   * The list stays in the page while folded, so a test or `reveal` still
   * finds every choice by its value. In the list the arrows walk and pick
   * like a radio group, all four of them; a click picks and folds it;
   * Escape folds it.
   */
  let { label, items, active, onpick, testid }: {
    label: string;
    items: { id: string; label: string; title?: string }[];
    active: string | null;
    onpick: (id: string) => void;
    testid: string;
  } = $props();

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
    fold();
  }
</script>

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
  .choice:hover { background: var(--color-hover); color: var(--color-foreground); }
  .choice[aria-checked='true'] { color: var(--color-foreground); font-weight: 500; }
  .mark { display: inline-flex; flex: none; width: 14px; color: var(--color-accent); }
  @media (max-width: 720px) {
    .current { min-height: var(--touch-target); }
    .choice { min-height: var(--touch-target); }
  }
</style>
