<script lang="ts">
  import { Plus, Star } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { ProviderSummary } from '@boite/contracts';
  import ProviderLogo from './ProviderLogo.svelte';
  import { strings } from '../lib/strings';
  import { connected } from '../lib/provider-setup';
  import type { Choice, Store } from '../lib/store.svelte';

  /**
   * The model picker's rail: the favorites tile, then one tile per provider in
   * the order the core listed them, scrolling under a fade when the menu is
   * shorter than the rail; the add tile and the menu's `foot` stay pinned at
   * its end. A tile only moves the column beside it.
   */
  let {
    store,
    choice,
    locked,
    current,
    favoritesOpen,
    onfavorites,
    onpick,
    onmore,
    foot
  }: {
    store: Store;
    choice: Choice | null;
    locked: boolean;
    /** The provider whose column is shown. */
    current: string | null;
    favoritesOpen: boolean;
    onfavorites: () => void;
    onpick: (providerId: string) => void;
    /** The last tile, while some providers are left out: Settings, where they are connected. */
    onmore?: () => void;
    /** Pinned after the add tile: the menu's refresh. */
    foot?: Snippet;
  } = $props();

  let list = $state<HTMLDivElement | undefined>(undefined);
  /** Tiles hidden past either end of the scrolling list: each fades its edge. */
  let hiddenStart = $state(false);
  let hiddenEnd = $state(false);
  $effect(() => {
    const box = list;
    if (!box) return;
    const measure = () => {
      const across = box.scrollWidth > box.clientWidth + 1;
      const offset = across ? box.scrollLeft : box.scrollTop;
      const room = across ? box.scrollWidth - box.clientWidth : box.scrollHeight - box.clientHeight;
      hiddenStart = offset > 1;
      hiddenEnd = room - offset > 1;
    };
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(box);
    return () => { box.removeEventListener('scroll', measure); resize?.disconnect(); };
  });

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

<div class="rail" data-testid="picker-rail">
  <div class="tiles" class:hidden-start={hiddenStart} class:hidden-end={hiddenEnd} data-testid="picker-rail-tiles" bind:this={list}>
    <button type="button" class="tile" class:current={favoritesOpen} role="menuitem" data-row data-provider="favorites" title={strings.composer.favorites} aria-label={strings.composer.favorites} onclick={onfavorites}><Star size={24} /></button>
    {#each tiles as tile (tile.provider.id)}
      <button
        type="button"
        class="tile"
        class:current={!favoritesOpen && current === tile.provider.id}
        class:dim={tile.reason !== null}
        disabled={tile.held}
        role="menuitem"
        data-row
        data-provider={tile.provider.id}
        title={tileTitle(tile)}
        aria-label={tile.provider.name}
        onclick={() => pickTile(tile)}
      >
        <ProviderLogo providerId={tile.provider.id} size={28} />
      </button>
    {/each}
  </div>
  <div class="foot">
    {#if onmore && listed.length < store.providers.length}
      <button type="button" class="tile more" role="menuitem" data-row data-provider="more" data-testid="picker-more-providers" title={strings.settings.connectProvider} aria-label={strings.settings.connectProvider} onclick={onmore}><Plus size={20} /></button>
    {/if}
    {@render foot?.()}
  </div>
</div>

<style>
  /* Fills the menu's rail cell: the tiles scroll, the foot stays. */
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    min-height: 0;
    padding: 4px;
  }
  .tiles {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    scrollbar-width: none;
  }
  .tiles::-webkit-scrollbar { display: none; }
  /* A short fade on the edge past which tiles wait, so the rail reads as scrollable. */
  .tiles.hidden-end { mask-image: linear-gradient(to bottom, black calc(100% - var(--space-5)), transparent); }
  .tiles.hidden-start { mask-image: linear-gradient(to bottom, transparent, black var(--space-5)); }
  .tiles.hidden-start.hidden-end { mask-image: linear-gradient(to bottom, transparent, black var(--space-5), black calc(100% - var(--space-5)), transparent); }
  .foot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex: none;
  }
  .foot:not(:has(> *)) { display: none; }
  .foot:has(> *) { padding-top: 2px; }

  .tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--control-lg);
    height: var(--control-lg);
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-muted-foreground);
    transition:
      background var(--dur-2) var(--ease-out-quint),
      color var(--dur-2) var(--ease-out-quint);
  }

  /* The accent ring of every focusable thing marks the keyboard's tile; a finger's tap leaves no fill behind. */
  .tile:focus-visible {
    background: var(--color-hover);
    color: var(--color-foreground);
  }
  @media (hover: hover) {
    .tile:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); }
  }

  .tile.current {
    background: var(--color-active);
    color: var(--color-foreground);
  }

  .tile.more { color: var(--color-subtle); }

  /* Nothing runs on it: still pickable, so its column can say why. */
  .tile.dim {
    opacity: 0.45;
  }

  @media (max-width: 720px) {
    /* A strip across the top: the tiles scroll sideways, the add tile and the refresh end it. */
    .rail, .tiles, .foot { flex-direction: row; }
    .rail { padding: 0 0 6px; }
    .tiles { width: auto; height: auto; overflow-x: auto; overflow-y: hidden; touch-action: pan-x; }
    .tiles.hidden-end { mask-image: linear-gradient(to right, black calc(100% - var(--space-5)), transparent); }
    .tiles.hidden-start { mask-image: linear-gradient(to right, transparent, black var(--space-5)); }
    .tiles.hidden-start.hidden-end { mask-image: linear-gradient(to right, transparent, black var(--space-5), black calc(100% - var(--space-5)), transparent); }
    .foot:has(> *) { padding: 0 0 0 2px; }
    /* The rail is the finger's first stop on a phone, so its tiles take a
       full touch target like every other control. */
    .tile {
      width: var(--touch-target);
      height: var(--touch-target);
    }
  }
</style>
