<script lang="ts" module>
  import type { Component } from 'svelte';
  import type { SettingsTab } from '../lib/store.svelte';

  /** One place the search can land: a page, or a card on it. */
  export type SettingsEntry = { tab: SettingsTab; section: string | null; label: string; trail: string };
  export type SettingsTile = { id: SettingsTab; label: string; icon: Component<{ size?: number; strokeWidth?: number }> };
  /** A group of the nav and of Home: its first page, then the others it holds. */
  /** A nav entry: its lead page, the pages tabbed beside it and the pages merged into it as sections. */
  export type SettingsGroup = SettingsTile & { members: SettingsTile[]; sections?: SettingsTile[] };
</script>

<script lang="ts">
  import { ChevronRight, Search } from '@lucide/svelte';
  import { connected } from '../lib/provider-setup';
  import { providerRows } from '../lib/provider-family';
  import { fill, strings } from '../lib/strings';
  import { workspace } from '../lib/workspace.svelte';
  import type { Store } from '../lib/store.svelte';

  /**
   * Where Settings opens: a search over every page and card, then one tile
   * per group. A tile names the pages it holds beyond its own, or a state
   * worth reading from here: how many providers answer, how many machines.
   */
  let { store, tiles, entries, onopen }: {
    store: Store;
    tiles: SettingsGroup[];
    entries: SettingsEntry[];
    onopen: (entry: SettingsEntry) => void;
  } = $props();

  let query = $state('');
  let field = $state<HTMLInputElement>();
  /** The result Enter opens: the arrows move it, a new query puts it back on top. */
  let active = $state(0);

  /** "Clavier" finds "clavier", "Récents" finds "recents": case and accents never decide a match. */
  const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  let results = $derived.by(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return entries.filter((entry) => {
      const text = fold(`${entry.label} ${entry.trail}`);
      return words.every((word) => text.includes(word));
    }).slice(0, 12);
  });

  let rows = $derived(providerRows(store.providers));
  let ready = $derived(rows.filter((row) => row.members.some((provider) => connected(provider, store.shownAccounts()))).length);
  let machines = $derived(Math.max(1, workspace.machines.length));

  /** The state line under a tile, null when the page has none worth a glance. */
  function status(tab: SettingsTab): { text: string; tone?: 'call' } | null {
    if (tab === 'accounts' && store.providers.length > 0) {
      return ready === 0 ? { text: strings.settings.connectProvider, tone: 'call' } : { text: ready === 1 ? strings.settings.providersOne : fill(strings.settings.providersReady, { count: String(ready) }) };
    }
    if (tab === 'machines') {
      const parts = machines > 1 ? [fill(strings.settings.machinesCount, { count: String(machines) })] : [];
      if (store.sessions.length > 0) parts.push(store.sessions.length === 1 ? strings.settings.devicesOne : fill(strings.settings.devicesCount, { count: String(store.sessions.length) }));
      return parts.length > 0 ? { text: parts.join(' · ') } : null;
    }
    return null;
  }


  /**
   * What a tile holds when it has no state to show: its other pages and merged sections, else the
   * first cards of its own page, so every tile says what is inside it.
   */
  function contents(tile: SettingsGroup): { text: string; tone?: 'call' } | null {
    const inside = [...tile.members, ...tile.sections ?? []];
    const names = inside.length > 0
      ? inside.map((member) => member.label)
      : entries.filter((entry) => entry.tab === tile.id && entry.section !== null && entry.trail === tile.label).slice(0, 3).map((entry) => entry.label);
    return names.length > 0 ? { text: names.join(' · ') } : null;
  }

  $effect(() => {
    if (store.connection === 'ready') void store.loadSessions();
  });

  // Settings opens to be searched: the keyboard lands in the field. A touch
  // screen would answer with its keyboard over the tiles, so it waits for a tap.
  $effect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) field?.focus({ preventScroll: true });
  });

  function onkey(event: KeyboardEvent) {
    const picked = results[Math.min(active, results.length - 1)];
    if (event.key === 'Enter' && picked) {
      event.preventDefault();
      onopen(picked);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length > 0) {
      event.preventDefault();
      active = (Math.min(active, results.length - 1) + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      query = '';
    }
  }
</script>

<div class="page home" data-testid="settings-home">
  <header>
    <h1>{strings.settings.heading}</h1>
  </header>

  <label class="search">
    <Search size={16} strokeWidth={1.75} />
    <input type="search" bind:this={field} bind:value={query} oninput={() => (active = 0)} placeholder={strings.settings.search} aria-label={strings.settings.search} data-testid="settings-search" onkeydown={onkey} spellcheck="false" autocomplete="off" />
  </label>

  {#if query.trim()}
    {#if results.length === 0}
      <p class="hint" data-testid="settings-search-empty">{strings.settings.searchEmpty}</p>
    {:else}
      <div class="card flush results" data-testid="settings-search-results">
        {#each results as entry, index (`${entry.tab}:${entry.section}:${entry.label}`)}
          <button type="button" class="ghost result" class:active={index === Math.min(active, results.length - 1)} data-testid="settings-search-result" onpointermove={() => (active = index)} onclick={() => onopen(entry)}>
            <span class="label ui-label">{entry.label}</span>
            {#if entry.trail}<span class="trail ui-label">{entry.trail}</span>{/if}
            <ChevronRight size={15} />
          </button>
        {/each}
      </div>
    {/if}
  {:else}
      <div class="tiles">
        {#each tiles as tile (tile.id)}
          {@const Icon = tile.icon}
          {@const line = status(tile.id) ?? contents(tile)}
          <button type="button" class="tile" data-testid="settings-home-{tile.id}" onclick={() => onopen({ tab: tile.id, section: null, label: tile.label, trail: '' })}>
            <span class="glyph"><Icon size={18} strokeWidth={1.75} /></span>
            <span class="text">
              <span class="label">{tile.label}</span>
              {#if line}<span class="status" class:call={line.tone === 'call'}>{line.text}</span>{/if}
            </span>
          </button>
        {/each}
      </div>
  {/if}
</div>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: var(--settings-width);
    height: 40px;
    padding: 0 var(--space-3);
    margin-bottom: var(--space-6);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    transition: border-color var(--dur-2);
  }
  /* A field brightens its edge on focus, as every field does (app.css): an autofocused search wore an accent frame. */
  .search:focus-within { border-color: var(--color-composer-focus); }
  .search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; box-shadow: none; outline: none; font-size: var(--text-base); }
  .search input::-webkit-search-cancel-button { display: none; }

  /* Four tiles a row while the longest French label still fits on one line,
     else two, else one. Seven groups: at two a row the last tile takes the whole row.
     A row's tiles stretch to its tallest; no row reserves lines it has not. */
  .home { container-type: inline-size; }

  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    max-width: var(--settings-width);
    margin-bottom: var(--space-8);
  }

  /* The glyph sits above the words, so a long French label keeps the tile's
     whole width instead of the room left beside an icon. */
  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: var(--space-3);
    height: auto;
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: none;
    text-align: left;
    white-space: normal;
    font-weight: normal;
    color: var(--color-foreground);
    transition: background var(--dur-2), border-color var(--dur-2);
  }
  @media (hover: hover) { .tile:hover { background: var(--color-hover); border-color: var(--color-edge); } }
  .tile:active:not(:disabled) { transform: none; }

  .glyph {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    transition: color var(--dur-2);
  }
  .tile:hover .glyph { color: var(--color-foreground); }

  .text { display: grid; align-content: start; gap: 2px; width: 100%; min-width: 0; }
  .label { font-size: var(--text-base); font-weight: 600; line-height: 1.3; overflow-wrap: break-word; }
  .status { font-size: var(--text-sm); line-height: 1.35; color: var(--color-muted-foreground); overflow-wrap: break-word; }
  .status.call { color: var(--color-foreground); }

  /* Two a row, the glyph goes back beside the words: a half-width tile is wide
     enough for both and a tall one would be mostly empty. */
  @container (max-width: 840px) {
    .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tile:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .tile { flex-direction: row; align-items: center; }
    .text { align-content: center; }
  }
  @container (max-width: 440px) {
    .tiles { grid-template-columns: minmax(0, 1fr); }
  }

  .results { max-width: var(--settings-width); display: grid; }
  .result {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-3);
    height: auto;
    min-height: var(--row);
    padding: var(--space-2) var(--space-4);
    border-radius: 0;
    color: var(--color-foreground);
    text-align: left;
  }
  button.result.active { background: var(--color-hover); }
  .result + .result { border-top: 1px solid var(--color-border); }
  .result .label { flex: none; max-width: 60%; }
  .result .trail { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result :global(svg) { flex: none; color: var(--color-subtle); }
</style>
