<script lang="ts">
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { count } from '../lib/format';
  import { fill, strings } from '../lib/strings';

  let { entry }: { entry: ProjectEntry } = $props();
  const total = $derived(entry.machine.store.threadsOf(entry.project.id).length);
  const label = $derived(fill(total === 1 ? strings.sidebar.threadCountOne : strings.sidebar.threadCountMany, { count: count(total) }));
</script>

<span class="total ui-label" data-testid="project-thread-count" title={label} aria-label={label}>{count(total)}</span>

<style>
  .total { flex: none; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 400; font-variant-numeric: tabular-nums; }
</style>
