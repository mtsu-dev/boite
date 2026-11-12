<script lang="ts">
  import { pluginUi, type PluginSlot } from '../lib/plugin-ui.svelte';
  import { fill, strings } from '../lib/strings';

  /**
   * The buttons plugin interfaces put in one slot. A plugin names its icon as
   * a few characters (an emoji) or as SVG markup; its own script already runs
   * in this page, so drawing its markup grants nothing more.
   */
  let { slot, threadId = null, compact = false }: { slot: PluginSlot; threadId?: string | null; compact?: boolean } = $props();

  let buttons = $derived(pluginUi.buttonsFor(slot));
  const svg = (icon: string) => icon.trimStart().startsWith('<svg');
</script>

{#each buttons as button (button.key)}
  {@const tip = `${button.label} · ${fill(strings.pluginUi.from, { name: pluginUi.name(button.plugin) })}`}
  <button
    type="button"
    class="plugin-slot ghost"
    class:compact
    data-testid="plugin-button"
    data-plugin={button.plugin}
    data-slot={slot}
    title={tip}
    aria-label={button.label}
    onclick={() => button.run({ threadId })}
  >
    <span class="glyph" aria-hidden="true">
      {#if button.icon && svg(button.icon)}{@html button.icon}{:else}{button.icon ?? button.label.slice(0, 1).toUpperCase()}{/if}
    </span>
  </button>
{/each}

<style>
  .plugin-slot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: var(--control);
    height: var(--control);
    padding: 0 6px;
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
    transition: background-color var(--dur-1) ease, color var(--dur-1) ease, transform var(--dur-1) var(--ease-out-quint);
  }
  .plugin-slot:hover { background: var(--color-hover); color: var(--color-foreground); }
  .plugin-slot:active { transform: scale(0.94); }
  .plugin-slot.compact { min-width: var(--control-sm); height: var(--control-sm); }
  .glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    font-size: 14px;
    line-height: 1;
  }
  .glyph :global(svg) { width: 16px; height: 16px; }
</style>
