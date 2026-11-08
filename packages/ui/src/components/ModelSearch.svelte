<script lang="ts">
  import { Search } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The model picker's search field, on its top row above the list (which
   * scrolls on its own). `input` is bound so the picker's arrows can come back to it.
   */
  let {
    value = $bindable(''),
    input = $bindable()
  }: { value?: string; input?: HTMLInputElement | undefined } = $props();
</script>

<div class="search-bar">
  <label class="search">
    <Search size={13} strokeWidth={1.75} />
    <input
      bind:this={input}
      bind:value
      type="search"
      autocomplete="off"
      autocapitalize="off"
      placeholder={strings.composer.searchModels}
      aria-label={strings.composer.searchModels}
      data-testid="picker-search"
      spellcheck="false"
    />
  </label>
</div>

<style>
  /* The sidebar's search box; the picker's top row places it. */
  .search-bar { min-width: 0; }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--control-sm);
    padding: 0 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-subtle);
    transition: border-color var(--dur-2) var(--ease-out-quint);
  }

  .search:focus-within {
    border-color: var(--color-edge);
    color: var(--color-muted-foreground);
  }

  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-foreground);
    font-size: var(--text-sm);
  }

  .search input:focus {
    outline: none;
  }

  /* A phone's field is a 44 px target end to end: the hairline is drawn
     inside, so the input fills the whole height a finger lands on. */
  @media (max-width: 720px) {
    .search { height: var(--touch-target); border: 0; box-shadow: inset 0 0 0 1px var(--color-border); }
    .search:focus-within { box-shadow: inset 0 0 0 1px var(--color-edge); }
  }
</style>
