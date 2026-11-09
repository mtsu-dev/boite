<script lang="ts">
  import { ArrowRight, Check, ChevronRight, Plus } from '@lucide/svelte';
  import type { ProviderSummary } from '@boite/contracts';
  import ProviderLogo from './ProviderLogo.svelte';
  import { strings } from '../lib/strings';
  import { listedProviders } from '../lib/picker-providers';
  import type { Choice, Store } from '../lib/store.svelte';

  /**
   * The model picker's sources, unfolded in place under its search row: one
   * row per provider in the order the core listed them, its mark in monochrome
   * beside its name, the shown one checked. A row only moves the list under it;
   * its end says where it leads: a chevron to its models, "Set up" with the
   * reason under the name when it cannot run yet, an arrow out to Settings.
   * Folded, the rows stay in the page (the same nodes when they unfold) but
   * leave the arrows' path.
   */
  let {
    store,
    choice,
    locked,
    current,
    open = true,
    onpick,
    onmore
  }: {
    store: Store;
    choice: Choice | null;
    locked: boolean;
    /** The provider whose column is shown. */
    current: string | null;
    /** Folded: no row is on the arrows' path. */
    open?: boolean;
    onpick: (providerId: string) => void;
    /** The last tile, while some providers are left out: Settings, where they are connected. */
    onmore?: () => void;
  } = $props();

  interface Tile {
    provider: ProviderSummary;
    /** Why this provider cannot run, or null: it dims the tile and rides in its title. */
    reason: string | null;
    /** True while an open thread holds the choice on another provider. */
    held: boolean;
  }

  let listed = $derived(listedProviders(store, choice));
  let tiles = $derived.by((): Tile[] => {
    return listed.map((entry) => {
      const reason = !entry.available
        ? strings.composer.unavailable
        : store.accountsOf(entry.id).length === 0
          ? strings.composer.noAccount
          : null;
      return { provider: entry, reason, held: locked && choice?.providerId !== entry.id };
    });
  });

  function tileTitle(tile: Tile): string {
    if (tile.held) return strings.composer.lockedHint;
    return tile.reason === null ? tile.provider.name : `${tile.provider.name}, ${tile.reason}`;
  }

  /** A tile only moves the column: the choice follows a model or an account chip. */
  function pickTile(tile: Tile) {
    if (tile.held) return;
    onpick(tile.provider.id);
  }
</script>

{#each tiles as tile (tile.provider.id)}
  <button
    type="button"
    class="tile"
    class:current={current === tile.provider.id}
    class:dim={tile.reason !== null}
    disabled={tile.held}
    role="menuitem"
    data-row={open || undefined}
    data-provider={tile.provider.id}
    title={tileTitle(tile)}
    onclick={() => pickTile(tile)}
  >
    <span class="mark" aria-hidden="true">{#if current === tile.provider.id}<Check size={14} />{/if}</span>
    <ProviderLogo providerId={tile.provider.id} size={14} />
    <span class="text"><span class="tile-name ui-label">{tile.provider.name}</span>{#if tile.reason}<span class="reason">{tile.reason}</span>{/if}</span>
    {#if tile.reason}<span class="lead ui-label">{strings.composer.setUp}</span>{/if}
    <ChevronRight size={14} strokeWidth={2} class="chevron" />
  </button>
{/each}
{#if onmore && listed.length < store.providers.length}
  <button type="button" class="tile more" role="menuitem" data-row={open || undefined} data-provider="more" data-testid="picker-more-providers" onclick={onmore}><span class="mark" aria-hidden="true"></span><Plus size={14} /><span class="text"><span class="tile-name ui-label">{strings.settings.connectProvider}</span></span><ArrowRight size={14} strokeWidth={2} class="chevron" /></button>
{/if}

<style>
  /* Every menu's row: one height, inset and radius per device (`--overlay-row`). */
  .tile {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    min-height: var(--overlay-row);
    padding: var(--space-1) var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    font-size: var(--text-base);
    font-weight: 400;
    text-align: left;
  }

  /* Every mark in one ink: the names tell the providers apart. */
  .tile :global(.logo) { flex: none; filter: grayscale(1); }
  .text { display: flex; flex: 1; flex-direction: column; gap: 1px; min-width: 0; }
  .tile-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mark { display: inline-flex; flex: none; width: 14px; color: var(--color-accent); }
  .reason { color: var(--color-subtle); font-size: var(--text-xs); line-height: 16px; }
  .lead { flex: none; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 500; }
  .tile :global(.chevron) { flex: none; color: var(--color-subtle); }

  .tile:focus-visible { background: var(--color-hover); }
  @media (hover: hover) { .tile:hover:not(:disabled) { background: var(--color-hover); } }

  .tile.more { color: var(--color-muted-foreground); }
  .tile.more :global(svg) { flex: none; }

  /* Nothing runs on it: still pickable, so its list can say why. */
  .tile.dim .tile-name, .tile.dim :global(.logo) { opacity: 0.55; }
</style>
