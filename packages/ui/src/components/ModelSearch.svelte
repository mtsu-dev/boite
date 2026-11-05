<script lang="ts">
  import { Search } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The search field over the model column, outside its scroller so it stays
   * in place while the rows scroll. `input` is bound so the picker's arrows can come back to it.
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
  /* The sidebar's search box, above the model list (ModelPicker) rather than
     inside it, so rows never scroll under it and it paints nothing: the menu or
     sheet shows through, glass or solid, with no strip of another colour. */
  .search-bar {
    padding: 6px 6px 0;
    background: transparent;
  }

  /* Its glyph sits over the rows' dot slot and its text starts on the model names' column:
     7 px and the 1 px border match a row's 8 px inset, the 8 px gap the row's. */
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--control-sm);
    padding: 0 8px 0 7px;
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

  @media (max-width: 720px) {
    .search { height: var(--control-touch); }
  }
</style>
