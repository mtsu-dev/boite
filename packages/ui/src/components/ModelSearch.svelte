<script lang="ts">
  import { strings } from '../lib/strings';
  import SearchField from './SearchField.svelte';

  /**
   * The search field over the model column, kept in place while the rows
   * scroll under it. `input` is bound so the picker's arrows can come back to it.
   */
  let {
    value = $bindable(''),
    input = $bindable()
  }: { value?: string; input?: HTMLInputElement | undefined } = $props();
</script>

<div class="search-bar">
  <SearchField bind:input bind:value compact placeholder={strings.composer.searchModels} data-testid="picker-search" />
</div>

<style>
  /* The sidebar's search box, kept in place while hundreds of rows scroll under it. */
  .search-bar {
    position: sticky;
    /* The column pads by 6, so the bar starts 6 higher and paints that strip itself. */
    top: -6px;
    z-index: 1;
    margin: 0 -6px 4px;
    padding: 6px 6px 4px;
    background: var(--overlay-surface);
  }

  /* On a phone sheet the bar paints the sheet's own fill as it sticks. */
  :global([data-mobile-sheet='true']) .search-bar { background: var(--color-sheet); }

</style>
