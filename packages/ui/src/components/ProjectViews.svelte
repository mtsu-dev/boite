<script lang="ts">
  import { Plus, Search } from '@lucide/svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { work } from '../lib/work-prefs.svelte';
  import { projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import DisplayOptions from './DisplayOptions.svelte';
  import ViewSwitch from './ViewSwitch.svelte';
  import { inbox } from '../lib/inbox.svelte';

  /**
   * The thread list's head: its two views, Projects and Recent, both named,
   * the one on marked, a press away from each other. Then the display menu,
   * search and a new thread.
   * Recent's project filter and the machine filter live in the display menu,
   * which marks its button while one of them hides threads.
   */
  /** `quiet`: the first run, no AI and no project yet: the head stays empty, its height kept, so nothing points at an empty list. */
  let { entries, store, quiet = false }: { entries: ProjectEntry[]; store: Store; quiet?: boolean } = $props();
  const selected = $derived(projectView.selected(entries));
  const target = $derived(workspace.view === 'recent' && selected ? selected.project : store.openProject ?? store.projects.find(p => !p.archived));
  const targetOwner = $derived(workspace.view === 'recent' && selected ? selected.machine.store : store);
  const newLabel = $derived(target ? fill(strings.sidebar.newThreadIn, { project: projectName(target) }) : strings.sidebar.newThread);
  /** The filters that hide threads, counted on the display button: the project Recent lists, the machine. */
  const filters = $derived(Number(workspace.view === 'recent' && selected !== undefined) + Number(machineFilter.shown(workspace.machinesOr(store)) !== null));
  const addProject = $derived(store.owner && work.shows('sidebar.add-project') ? () => { store.projectPickerOpen = true; } : undefined);
  /** Always a new draft: one already written stays in the list, where it was. */
  async function create() {
    inbox.open = false;
    if (workspace.view === 'recent' && selected) await workspace.select(selected.machine.store, undefined, selected.project.id, { fresh: true });
    else store.startDraft(undefined, { fresh: true });
  }
</script>

{#if quiet}
<div class="list-head" data-testid="list-first-run" aria-hidden="true"></div>
{:else}
<div class="list-head">
  <h2 class="title" data-testid="list-view-name"><ViewSwitch label={strings.sidebar.displayView} current={workspace.view} onpick={view => workspace.setView(view as 'projects' | 'recent')}
    options={[{ id: 'projects', label: strings.sidebar.projectsView }, { id: 'recent', label: strings.sidebar.recentView }]} testid="view-switch" /></h2>
  <div class="actions">
    <DisplayOptions {entries} {target} owner={targetOwner} {filters} onaddproject={addProject} />
    {#if entries.length}
      <button class="ghost icon small" title={`${strings.sidebar.search}${store.keyHint('palette')}`} aria-label={strings.sidebar.search} data-testid="sidebar-search-open" onclick={() => store.paletteOpen = true}><Search size={16} /></button>
      <button class="ghost icon small new" title={`${newLabel}${store.keyHint('new-thread')}`} aria-label={newLabel} data-testid="new-thread" onclick={create}><Plus size={16} /></button>
    {/if}
  </div>
</div>
{/if}

<style>
  /* No rule under it: the rows fade out beneath it instead (RailFrame.svelte). */
  .list-head { display: flex; align-items: center; gap: 4px; min-width: 0; height: 36px; margin-top: 10px; padding: 0 0 0 8px; }
  .title { display: flex; flex: 1; min-width: 0; margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.015em; color: var(--color-foreground); }
  .actions { display: flex; align-items: center; gap: 4px; flex: none; }
  /* A pointer's full 32 px target each. */
  .actions :global(button.icon) { flex: none; width: 32px; height: 32px; border-radius: var(--radius-md); color: var(--color-muted-foreground); }
  .actions :global(button.icon:hover) { color: var(--color-foreground); }
  /* The one filled button: a new thread is the list's main action. */
  .actions .new.icon { background: var(--color-surface-2); color: var(--color-muted-foreground); }
  @media (max-width: 720px) {
    /* `button.icon` grows to the touch target on a phone. */
    .actions :global(button.icon) { width: var(--touch-target); height: var(--touch-target); }
  }
</style>
