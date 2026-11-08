<script lang="ts" module>
  import { getContext, setContext, type Snippet } from 'svelte';

  const KEY = Symbol('picker-more');
  /**
   * The More row's level: open, the picker shows it in place of everything
   * else (`ModelPickerMenu.svelte`), so its first level stays the models,
   * the effort and this one row.
   */
  export interface MoreLevel { open: boolean; rows: Snippet | null }

  /** The picker hands its body one level state, which it reads to draw the More level alone. */
  export function provideMoreLevel(level: MoreLevel): void {
    setContext(KEY, level);
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The model picker's named row for speed and context: it reads their
   * current values and opens them as a level of their own, under a way back
   * that bears its name. Each opening of the picker starts on the first
   * level (`ModelPickerMenu.reset`); `ModelPicker.reveal` opens it to reach
   * a row inside. Up and down cross the picker's rows like any other row;
   * right opens, left comes back.
   */
  let { summary, children }: { summary: string; children: Snippet } = $props();

  /** Outside a picker that provides the level, the rows open under the row. */
  const own = $state<MoreLevel>({ open: false, rows: null });
  const level = getContext<MoreLevel | undefined>(KEY) ?? own;
  let button = $state<HTMLButtonElement | undefined>(undefined);

  function toggle(open: boolean) {
    const menu = button?.closest('[data-testid=composer-picker-menu]');
    if (open) level.rows = children;
    level.open = open;
    // The keys follow the level: onto its first row, or back onto the row that opens it.
    void tick().then(() => menu?.querySelector<HTMLElement>(open ? '[data-picker-more] .rows [data-row]:not(:disabled)' : '[data-testid=composer-picker-more]')?.focus());
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight' && !level.open) {
      event.preventDefault();
      toggle(true);
    } else if (event.key === 'ArrowLeft' && level.open) {
      event.preventDefault();
      toggle(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = Array.from(button?.closest('[data-testid=composer-picker-menu]')?.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)') ?? []);
      const here = button ? rows.indexOf(button) : -1;
      rows[(here + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
    }
  }

  /** Left from a row of the level comes back, unless that row took the key for its own choices. */
  function onrowskey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' || event.defaultPrevented || event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    toggle(false);
  }
</script>

<div class="level" data-picker-more>
  <button type="button" class="ghost more" class:back={level.open} data-row data-testid="composer-picker-more" aria-expanded={level.open} bind:this={button} onclick={() => toggle(!level.open)} {onkeydown}>
    {#if level.open}<ChevronLeft size={14} strokeWidth={2} />{/if}
    <span class="ui-label name">{strings.composer.pickerMore}</span>
    {#if !level.open && summary}<span class="summary ui-label" data-testid="composer-picker-more-summary">{summary}</span>{/if}
    {#if !level.open}<ChevronRight size={14} strokeWidth={2} />{/if}
  </button>
  {#if level.open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="rows" onkeydown={onrowskey}>{@render children()}</div>
  {/if}
</div>

<style>
  .level { display: flex; flex-direction: column; gap: 2px; }
  .more { display: flex; align-items: center; gap: 6px; width: 100%; min-height: var(--control); padding: 4px 8px; border-radius: var(--radius-md); color: var(--color-foreground); font-size: var(--text-sm); font-weight: 400; justify-content: flex-start; }
  .more :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .name { flex: 0 1 auto; min-width: 0; }
  /* The way back names the level it stands on, as a menu's group title does. */
  .more.back { font-weight: 600; padding-left: 4px; }
  /* The values wrap rather than lose their end: nothing in the picker is cut. */
  .summary { margin-left: auto; min-width: 0; text-align: right; color: var(--color-subtle); }
  .more:not(.back) .summary + :global(svg) { margin-left: 0; }
  .more:not(.back) .name + :global(svg) { margin-left: auto; }
  .rows { display: flex; flex-direction: column; gap: 2px; animation: rise var(--dur-2) var(--ease-out-quint); }
  @media (max-width: 720px) { .more { min-height: var(--touch-target); } }
</style>
