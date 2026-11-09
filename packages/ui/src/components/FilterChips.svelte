<script lang="ts">
  import { X } from '@lucide/svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import type { AtWork } from './DisplayOptionsPanel.svelte';

  /**
   * The filters that hide threads, in words, on a line under the list's head:
   * the head keeps one glyph with a dot, so it never has to fit a project's
   * name beside both views, and each value is one press from gone.
   * `compact`: a phone's, which has no machine filter.
   */
  let { entries, owner, prefix = '', compact = false, atWork }: {
    entries: ProjectEntry[]; owner: Store; prefix?: string; compact?: boolean; atWork?: AtWork;
  } = $props();

  const chips = $derived.by(() => {
    const list: { id: string; label: string; clear: () => void }[] = [];
    if (atWork?.on) list.push({ id: 'working', label: strings.sidebar.filterWorking, clear: atWork.toggle });
    const project = workspace.view === 'recent' ? projectView.selected(entries) : undefined;
    if (project) list.push({ id: 'project', label: projectName(project.project), clear: () => projectView.pick('all') });
    const machines = workspace.machinesOr(owner);
    const id = compact ? null : machineFilter.shown(machines);
    const machine = id ? machines.find(entry => entry.id === id) : undefined;
    if (machine) list.push({ id: 'machine', label: machine.label, clear: () => machineFilter.set(null) });
    return list;
  });
</script>

{#if chips.length}
  <div class="filter-chips" role="group" aria-label={strings.sidebar.filter} data-testid={`${prefix}filter-chips`}>
    {#each chips as chip (chip.id)}
      {@const name = fill(strings.sidebar.filterClear, { name: chip.label })}
      <button type="button" class="ui-chip chip" title={name} aria-label={name} data-value={chip.id} data-testid={`${prefix}filter-chip`} onclick={chip.clear}>
        <span class="ui-label">{chip.label}</span><X size={14} aria-hidden="true" />
      </button>
    {/each}
  </div>
{/if}

<style>
  .filter-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; margin: 6px 0 2px; }
  .chip { max-width: 100%; height: 28px; padding: 0 6px 0 10px; border-radius: var(--radius-full); color: var(--color-foreground); font-weight: 500; }
  .chip:hover { background: var(--color-surface-3); }
  .chip .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .chip > :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .chip:hover > :global(svg) { color: var(--color-foreground); }
  @media (max-width: 720px) {
    .filter-chips { gap: 8px; margin: 0; }
    .chip { height: 36px; padding: 0 10px 0 14px; font-size: var(--text-body); }
  }
</style>
