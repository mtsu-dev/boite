<script lang="ts">
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { count } from '../lib/format';
  import { fill, strings } from '../lib/strings';

  let { entry }: { entry: ProjectEntry } = $props();
  const total = $derived(entry.machine.store.threadsOf(entry.project.id).length);
  const label = $derived(fill(total === 1 ? strings.sidebar.threadCountOne : strings.sidebar.threadCountMany, { count: count(total) }));
</script>

<span class="fold-count ui-label" style="color:var(--color-muted-foreground)" data-testid="project-thread-count" title={label} aria-label={label}>{count(total)}</span>
