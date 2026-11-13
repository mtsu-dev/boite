<script lang="ts">
  import { changeCount } from '../lib/change-count';

  /** "1 file, +7 −2" (`lib/change-count.ts`), the lines in the success and danger colours. */
  let { files = null, added, removed, testid }: { files?: number | null; added: number | null; removed: number | null; testid?: string } = $props();
  let count = $derived(changeCount(files, added, removed));
</script>

<span class="change-count ui-label" data-testid={testid}>{#if count.files}{count.files}{#if count.added || count.removed}{', '}{/if}{/if}{#if count.added}<span class="added">{count.added}</span>{/if}{#if count.added && count.removed}{' '}{/if}{#if count.removed}<span class="removed">{count.removed}</span>{/if}</span>

<style>
  .change-count { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .added { color: var(--color-success); }
  .removed { color: var(--color-danger); }
</style>
