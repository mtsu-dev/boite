<script lang="ts">
  import { ArrowLeft, ChevronDown, X } from '@lucide/svelte';
  import { separator, type MenuItem } from '../lib/menu';
  import { closeTabs } from '../lib/panel-close';
  import { launcherItems, pickLauncher } from '../lib/panel-launcher';
  import type { PanelCounts } from '../lib/panel-strip.svelte';
  import type { BoundPanel } from '../lib/right-panel.svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { surfaceGlyph } from '../lib/surface-glyphs';
  import { label, tooltip } from '../lib/surface-labels';
  import Menu from './Menu.svelte';
  import SurfaceIcon from './SurfaceIcon.svelte';

  /**
   * A phone shows one surface at a time: back to the chat, the surface's whole
   * name with its count, which opens the list of every other one, and its close.
   */
  let { store, panel, counts, onback }: { store: Store; panel: BoundPanel; counts: PanelCounts; onback: () => void } = $props();

  let active = $derived(panel.active);
  let count = $derived(active ? counts.of(active.kind) : null);
  let name = $derived(active ? label(active) : strings.rightPanel.newSurface);

  /** The tabs no kind of the list stands for (a file, a second browser) first, then the list. */
  let items = $derived.by((): MenuItem[] => {
    const extra = panel.surfaces.filter((surface) => surface.kind === 'file' || surface.kind === 'browser' || surface.kind === 'window' || surface.kind === 'council');
    return [
      ...extra.map((surface): MenuItem => ({ id: `surface:${surface.id}`, label: label(surface), title: tooltip(surface), glyph: surfaceGlyph(surface.kind), active: surface.id === panel.activeSurfaceId })),
      ...(extra.length > 0 ? [separator('sep-open')] : []),
      ...launcherItems(store, (kind) => counts.of(kind), active?.kind ?? null)
    ];
  });

  function pick(id: string): void {
    if (id.startsWith('surface:')) panel.activate(id.slice('surface:'.length));
    else pickLauncher(store, id);
  }
</script>

<button type="button" class="ghost icon back" title={strings.rightPanel.backToChat} aria-label={strings.rightPanel.backToChat}
  data-testid="panel-close" onclick={onback}>
  <ArrowLeft size={18} strokeWidth={1.75} />
</button>
<span class="picker">
  <Menu {items} onpick={pick} placement="bottom" variant="text" label={count ? `${name}, ${count.label}` : name} testid="panel-picker">
    {#if active}<SurfaceIcon kind={active.kind} size={16} />{/if}
    <span class="name" data-testid="panel-picker-name">{name}</span>
    {#if count}<span class="count" aria-hidden="true">{count.value}</span>{/if}
    <ChevronDown size={16} strokeWidth={1.75} />
  </Menu>
</span>
<span class="spacer"></span>
{#if active}
  {@const closeLabel = fill(strings.rightPanel.closeTab, { title: label(active) })}
  <button type="button" class="ghost icon" data-testid="panel-tab-close" title={closeLabel} aria-label={closeLabel}
    onclick={() => void closeTabs(panel, 'close', active.id)}>
    <X size={18} strokeWidth={1.75} />
  </button>
{/if}

<style>
  button.icon { flex: none; width: var(--touch-target); height: var(--touch-target); }
  .spacer { flex: 1; min-width: 4px; }
  .picker { display: flex; min-width: 0; flex: 0 1 auto; }
  .picker :global(.menu) { min-width: 0; max-width: 100%; }
  .picker :global(.trigger) {
    min-width: 0;
    max-width: 100%;
    min-height: var(--touch-target);
    gap: 8px;
    padding: 0 10px;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--color-foreground);
  }
  .picker :global(.trigger svg) { flex: none; }
  .picker :global(.trigger > svg:last-child) { color: var(--color-muted-foreground); }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    flex: none;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--color-surface-3);
    font-size: var(--text-xs);
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
