<script lang="ts">
  import { ChevronLeft } from '@lucide/svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /**
   * The one way back of every second level (a menu's named group, the model
   * picker's levels, the phone sheets): a chevron, the name of the level it
   * stands on, then a rule. It is a menu row, so it is as tall as the rows
   * under it on each device (`--overlay-row`).
   */
  let { label, element = $bindable(), ...rest }: { label: string; element?: HTMLButtonElement } & Omit<HTMLButtonAttributes, 'children'> = $props();
</script>

<button type="button" class="back-row" role="menuitem" data-row bind:this={element} {...rest}>
  <span class="glyph" aria-hidden="true"><ChevronLeft size={16} strokeWidth={1.75} /></span>
  <span class="ui-label">{label}</span>
</button>
<div class="back-rule" role="separator"></div>

<style>
  .back-row {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-2);
    width: 100%;
    height: auto;
    min-height: var(--overlay-row);
    padding: var(--space-1) var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    font-size: var(--text-base);
    font-weight: 600;
    text-align: left;
  }
  .back-row > .ui-label { min-width: 0; overflow-wrap: anywhere; white-space: normal; }
  .glyph { display: inline-flex; flex: 0 0 16px; margin-right: 2px; color: var(--color-muted-foreground); }
  @media (hover: hover) {
    .back-row:hover:not(:disabled) { background: var(--color-hover); }
  }
  .back-row:active:not(:disabled) { transform: none; background: var(--color-active); }
  .back-rule { flex: none; height: 1px; margin: var(--space-1) var(--overlay-row-pad); background: var(--color-border); }
</style>
