<script lang="ts">
  import { changeCount } from '../lib/change-count';

  /** "1 file, +7 −2" (`lib/change-count.ts`), the lines in the success and danger colours. */
  let { files = null, added, removed, testid }: { files?: number | null; added: number | null; removed: number | null; testid?: string } = $props();
  let count = $derived(changeCount(files, added, removed));
  /** "7 files" as its number and its word, where the language writes the number first: a tight head keeps the number. */
  let split = $derived(count.files?.match(/^(\d+)(\D+)$/) ?? null);
</script>

<span class="change-count ui-label" data-testid={testid}>{#if count.files}<span class="files">{#if split}{split[1]}<span class="word">{split[2]}</span>{:else}{count.files}{/if}{#if count.added || count.removed}{', '}{/if}</span>{/if}{#if count.added}<span class="added">{count.added}</span>{/if}{#if count.added && count.removed}{' '}{/if}{#if count.removed}<span class="removed">{count.removed}</span>{/if}</span>

<style>
  .change-count { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .added { color: var(--color-success); }
  .removed { color: var(--color-danger); }
  /* In a panel strip short of room (RightPanel.svelte): "7, +16 −7", then the lines alone when there are lines. */
  :global(.surface-head.tighter) .word { display: none; }
  :global(.surface-head.tightest) .files:not(:last-child) { display: none; }
</style>
