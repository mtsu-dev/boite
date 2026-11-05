<script lang="ts" module>
  import type { Component } from 'svelte';
  import type { SettingsTab } from '../lib/store.svelte';

  /** One place the search can land: a page, or a card on it. */
  export type SettingsEntry = { tab: SettingsTab; section: string | null; label: string; trail: string };
  export type SettingsTile = { id: SettingsTab; label: string; icon: Component<{ size?: number; strokeWidth?: number }>; group: number };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Search, X } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The field on top of the Settings nav. While it holds words, the nav lists
   * the pages, cards and single settings that match instead of its pages;
   * a result opens its page scrolled to its card. Empty, the nav is back.
   */
  let { entries, onopen, focus = false, children }: {
    entries: SettingsEntry[];
    onopen: (entry: SettingsEntry) => void;
    /** Settings opened to be looked through: the keyboard lands here. */
    focus?: boolean;
    children: Snippet;
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

  // A touch screen would answer a focused field with its keyboard over the page, so it waits for a tap.
  $effect(() => {
    if (focus && window.matchMedia('(hover: hover) and (pointer: fine)').matches) field?.focus({ preventScroll: true });
  });

  function pick(entry: SettingsEntry) {
    query = '';
    onopen(entry);
  }

  function onkey(event: KeyboardEvent) {
    const picked = results[Math.min(active, results.length - 1)];
    if (event.key === 'Enter' && picked) {
      event.preventDefault();
      pick(picked);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length > 0) {
      event.preventDefault();
      active = (Math.min(active, results.length - 1) + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
    } else if (event.key === 'Escape' && query) {
      // The first Escape empties the field; the next one is Settings' own.
      event.preventDefault();
      event.stopPropagation();
      query = '';
    }
  }
</script>

<label class="search">
  <Search size={15} strokeWidth={1.75} />
  <input type="search" bind:this={field} bind:value={query} oninput={() => (active = 0)} placeholder={strings.settings.search} aria-label={strings.settings.search} data-testid="settings-search" onkeydown={onkey} spellcheck="false" autocomplete="off" />
  {#if query}<button type="button" class="ghost icon clear" aria-label={strings.settings.searchClear} onclick={() => { query = ''; field?.focus(); }}><X size={14} /></button>{/if}
</label>

{#if query.trim()}
  {#if results.length === 0}
    <p class="empty" data-testid="settings-search-empty">{strings.settings.searchEmpty}</p>
  {:else}
    <div class="results" data-testid="settings-search-results">
      {#each results as entry, index (`${entry.tab}:${entry.section}:${entry.label}`)}
        <button type="button" class="ghost result" class:active={index === Math.min(active, results.length - 1)} data-testid="settings-search-result" onpointermove={() => (active = index)} onclick={() => pick(entry)}>
          <span class="label ui-label">{entry.label}</span>
          {#if entry.trail}<span class="trail ui-label">{entry.trail}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
{:else}
  {@render children()}
{/if}

<style>
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--control);
    padding: 0 4px 0 10px;
    margin-bottom: 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    transition: border-color var(--dur-2);
  }
  .search:focus-within { border-color: var(--color-edge); }
  .search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; box-shadow: none; outline: none; font-size: var(--text-sm); }
  .search input::-webkit-search-cancel-button { display: none; }
  .clear { flex: none; width: 24px; height: 24px; min-height: 24px; color: var(--color-muted-foreground); }

  .empty { padding: 6px 10px; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .results { display: grid; gap: 2px; }
  /* Label over its trail: the nav is too narrow to set them side by side. */
  .result {
    display: grid;
    justify-content: stretch;
    justify-items: start;
    gap: 1px;
    width: 100%;
    height: auto;
    min-height: var(--row);
    padding: 6px 10px;
    text-align: left;
    white-space: normal;
    line-height: 1.3;
    color: var(--color-foreground);
  }
  button.result.active { background: var(--color-hover); }
  .result .trail { font-size: var(--text-xs); color: var(--color-muted-foreground); }
</style>
