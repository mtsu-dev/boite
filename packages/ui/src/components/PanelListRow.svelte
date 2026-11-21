<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  let { selected, kind, touch = false, children, ...button }: HTMLButtonAttributes & {
    selected: boolean; kind: 'file' | 'change'; touch?: boolean;
  } = $props();
</script>

<button {...button} type="button" class="row {kind}" class:on={selected} class:touch>
  {@render children?.()}
</button>

<style>
  .row { display: flex; align-items: center; width: 100%; height: var(--row); border: none; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; text-align: left; }
  .row:hover:not(:disabled), .row:focus-visible { background: var(--row-hover, var(--color-hover)); }
  .row:active:not(:disabled) { transform: none; }
  .row.on { color: var(--color-foreground); }
  .file { gap: 4px; padding: 0 6px 0 calc(6px + var(--depth) * 12px); border-radius: var(--radius-sm); background: transparent; transition: color var(--dur-2) var(--ease-out-quint); }
  .file.on { background: var(--color-active); }
  .change { --row-hover: color-mix(in srgb, var(--color-hover) 60%, var(--color-surface-3)); position: sticky; top: 0; z-index: 2; gap: 6px; padding: 0 10px 0 6px; border-bottom: 1px solid var(--color-border); border-radius: 0; background: var(--color-surface-3); }
  .change:focus-visible { outline-offset: -2px; }
  .touch { height: auto; min-height: var(--touch-target); }
</style>
