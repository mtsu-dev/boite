<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronRight } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The model picker's second level: one quiet row under the effort that
   * reads the current values of what it holds (speed, permissions, context)
   * and opens them in place on demand. Each opening of the picker starts it
   * folded, since the body mounts afresh; `ModelPicker.reveal` unfolds it to
   * reach a row inside.
   */
  let { summary, children }: { summary: string; children: Snippet } = $props();

  let open = $state(false);
  let panel = $state<HTMLDivElement | undefined>(undefined);

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      open = true;
      queueMicrotask(() => panel?.querySelector<HTMLElement>('[role=radio][tabindex="0"], button')?.focus());
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowLeft') && open) {
      event.preventDefault();
      open = false;
    }
  }
</script>

<button type="button" class="ghost more" data-testid="composer-picker-more" aria-expanded={open} onclick={() => (open = !open)} {onkeydown}>
  <ChevronRight size={14} strokeWidth={2} />
  <span class="ui-label">{strings.composer.pickerMore}</span>
  {#if !open && summary}<span class="summary ui-label" data-testid="composer-picker-more-summary">{summary}</span>{/if}
</button>
{#if open}
  <div class="rows" bind:this={panel}>{@render children()}</div>
{/if}

<style>
  .more { display: flex; align-items: center; gap: 6px; width: 100%; min-height: var(--row); padding: 2px 8px 2px 6px; border-radius: var(--radius-md); color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; justify-content: flex-start; }
  .more:hover { color: var(--color-foreground); }
  .more :global(svg) { flex: none; transition: transform var(--dur-2) var(--ease-out-quint); }
  .more[aria-expanded='true'] :global(svg) { transform: rotate(90deg); }
  .summary { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-subtle); }
  .rows { display: flex; flex-direction: column; gap: 2px; animation: rise var(--dur-2) var(--ease-out-quint); }
  @media (max-width: 720px) { .more { min-height: var(--touch-target); } }
</style>
