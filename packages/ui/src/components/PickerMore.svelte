<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronRight } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The model picker's second level: one quiet row under the settings that
   * reads the current values of what it holds (speed, context) and opens them
   * in place on demand. Each opening of the picker starts it folded, since
   * the body mounts afresh; `ModelPicker.reveal` unfolds it to reach a row
   * inside. Up and down cross the picker's rows like any other row.
   */
  let { summary, children }: { summary: string; children: Snippet } = $props();

  let open = $state(false);
  let button = $state<HTMLButtonElement | undefined>(undefined);
  let panel = $state<HTMLDivElement | undefined>(undefined);

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      open = true;
      queueMicrotask(() => panel?.querySelector<HTMLElement>('[data-row]')?.focus());
    } else if (event.key === 'ArrowLeft' && open) {
      event.preventDefault();
      open = false;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = Array.from(button?.closest('[data-testid=composer-picker-menu]')?.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)') ?? []);
      const here = button ? rows.indexOf(button) : -1;
      rows[(here + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
    }
  }
</script>

<button type="button" class="ghost more" data-row data-testid="composer-picker-more" aria-expanded={open} bind:this={button} onclick={() => (open = !open)} {onkeydown}>
  <ChevronRight size={14} strokeWidth={2} />
  <span class="ui-label">{strings.composer.pickerMore}</span>
  {#if !open && summary}<span class="summary ui-label" data-testid="composer-picker-more-summary">{summary}</span>{/if}
</button>
{#if open}
  <div class="rows" bind:this={panel}>{@render children()}</div>
{/if}

<style>
  .more { display: flex; align-items: center; gap: 6px; width: 100%; min-height: var(--control); padding: 4px 8px 4px 6px; border-radius: var(--radius-md); color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; justify-content: flex-start; }
  .more:hover { color: var(--color-foreground); }
  .more :global(svg) { flex: none; transition: transform var(--dur-2) var(--ease-out-quint); }
  .more[aria-expanded='true'] :global(svg) { transform: rotate(90deg); }
  /* The values wrap rather than lose their end: nothing in the picker is cut. */
  .summary { margin-left: auto; min-width: 0; text-align: right; color: var(--color-subtle); }
  .rows { display: flex; flex-direction: column; gap: 2px; animation: rise var(--dur-2) var(--ease-out-quint); }
  @media (max-width: 720px) { .more { min-height: var(--touch-target); } }
</style>
