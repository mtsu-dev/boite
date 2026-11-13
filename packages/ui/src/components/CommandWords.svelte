<script lang="ts">
  /**
   * A command as text that wraps at its spaces only: each word is kept whole
   * (a path, a flag, a branch name like `orbit/csv-import`), and a word wider
   * than its box scrolls with the box instead of breaking at a hyphen.
   */
  let { text }: { text: string } = $props();
  const parts = $derived(text.split(/(\s+)/).filter(Boolean));
</script>

{#each parts as part, index (index)}{#if /\s/.test(part)}{part}{:else}<span class="word">{part}</span>{/if}{/each}

<style>
  .word { white-space: nowrap; }
</style>
