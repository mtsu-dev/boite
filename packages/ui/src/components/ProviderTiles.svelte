<script lang="ts">
  import { ChevronLeft, Plus } from '@lucide/svelte';
  import type { ProviderSummary } from '@boite/contracts';
  import ProviderLogo from './ProviderLogo.svelte';
  import { strings } from '../lib/strings';
  import { connected } from '../lib/provider-setup';
  import type { Choice, Store } from '../lib/store.svelte';

  /**
   * The model picker's row of providers under "All models", above their
   * models on every width: the way back to the models in use, then one tile
   * per provider in the order the core listed them, its mark in monochrome
   * beside its name. A tile only moves the list under it.
   */
  let {
    store,
    choice,
    locked,
    current,
    onback,
    onpick,
    onmore
  }: {
    store: Store;
    choice: Choice | null;
    locked: boolean;
    /** The provider whose column is shown. */
    current: string | null;
    /** Back to the first level, when it has models to show. */
    onback?: () => void;
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

  /**
   * One tile per provider the user can run, in the order the core listed them:
   * a provider with no signed-in account is Settings' business, not the
   * picker's. The one the choice is on stays, and with nothing connected at all
   * every provider shows, so the rail is never empty.
   */
  let listed = $derived.by((): ProviderSummary[] => {
    // A provider turned off is offered nowhere, the one an open thread sits on included.
    const offered = store.offeredProviders;
    const usable = offered.filter((entry) => connected(entry, store.accountsOf(entry.id)) || entry.id === choice?.providerId);
    return usable.some((entry) => connected(entry, store.accountsOf(entry.id))) ? usable : offered;
  });
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

{#if onback}
  <button type="button" class="tile back" role="menuitem" data-row data-provider="home" data-testid="picker-back" title={strings.composer.yourModels} onclick={onback}><ChevronLeft size={14} /><span class="tile-name ui-label">{strings.composer.yourModels}</span></button>
{/if}
{#each tiles as tile (tile.provider.id)}
  <button
    type="button"
    class="tile"
    class:current={current === tile.provider.id}
    class:dim={tile.reason !== null}
    disabled={tile.held}
    role="menuitem"
    data-row
    data-provider={tile.provider.id}
    title={tileTitle(tile)}
    onclick={() => pickTile(tile)}
  >
    <ProviderLogo providerId={tile.provider.id} size={14} />
    <span class="tile-name ui-label">{tile.provider.name}</span>
  </button>
{/each}
{#if onmore && listed.length < store.providers.length}
  <button type="button" class="tile more" role="menuitem" data-row data-provider="more" data-testid="picker-more-providers" title={strings.settings.connectProvider} aria-label={strings.settings.connectProvider} onclick={onmore}><Plus size={14} /></button>
{/if}

<style>
  .tile {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    flex: none;
    height: var(--control-sm);
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    text-align: left;
    transition:
      background var(--dur-2) var(--ease-out-quint),
      color var(--dur-2) var(--ease-out-quint);
  }

  /* Every mark in one ink: the names tell the providers apart. */
  .tile :global(.logo) { flex: none; filter: grayscale(1); }
  .tile-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .tile:focus-visible {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  @media (hover: hover) {
    .tile:hover:not(:disabled) {
      background: var(--color-hover);
      color: var(--color-foreground);
    }
  }

  .tile.current {
    background: var(--color-active);
    color: var(--color-foreground);
  }

  .tile.more { width: auto; color: var(--color-subtle); }
  .tile.back { color: var(--color-foreground); }

  /* Nothing runs on it: still pickable, so its column can say why. */
  .tile.dim {
    opacity: 0.45;
  }

  @media (max-width: 720px) {
    /* A finger's row, like every other control on a phone. */
    .tile { height: var(--touch-target); }
  }
</style>
