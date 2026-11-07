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
  import { inbox } from '../lib/inbox.svelte';

  /**
   * The thread list's head: its name, then the display menu, search and a new
   * thread; desktop Activity keeps the name only. Recent's project filter and the machine filter live in the display
   * menu, which marks its button while one of them hides threads.
   */
  let { entries, store }: { entries: ProjectEntry[]; store: Store } = $props();
  const selected = $derived(projectView.selected(entries));
  const target = $derived(workspace.view === 'recent' && selected ? selected.project : store.openProject ?? store.projects.find(p => !p.archived));
  const targetOwner = $derived(workspace.view === 'recent' && selected ? selected.machine.store : store);
  const newLabel = $derived(target ? fill(strings.sidebar.newThreadIn, { project: projectName(target) }) : strings.sidebar.newThread);
  const filtered = $derived((workspace.view === 'recent' && selected !== undefined) || machineFilter.shown(workspace.machinesOr(store)) !== null);
  const addProject = $derived(store.owner && work.shows('sidebar.add-project') ? () => { store.projectPickerOpen = true; } : undefined);
  /** Always a new draft: one already written stays in the list, where it was. */
  async function create() {
    if (workspace.view === 'recent' && selected) await workspace.select(selected.machine.store, undefined, selected.project.id, { fresh: true });
    else store.startDraft(undefined, { fresh: true });
  }
</script>

<div class="list-head">
  <h2 class="title">{inbox.open ? strings.mobile.activity : strings.sidebar.threads}</h2>
  <!-- Activity is one list: the display menu and a new thread belong to the threads. -->
  {#if !inbox.open}<div class="actions">
    <DisplayOptions {entries} {target} owner={targetOwner} {filtered} onaddproject={addProject} />
    {#if entries.length}
      <button class="ghost icon small" title={`${strings.sidebar.search}${store.keyHint('palette')}`} aria-label={strings.sidebar.search} data-testid="sidebar-search-open" onclick={() => store.paletteOpen = true}><Search size={16} /></button>
      <button class="ghost icon small new" title={`${newLabel}${store.keyHint('new-thread')}`} aria-label={newLabel} data-testid="new-thread" onclick={create}><Plus size={16} /></button>
    {/if}
  </div>{/if}
</div>

<style>
  /* No rule under it: the rows fade out beneath it instead (RailFrame.svelte). */
  .list-head { display: flex; align-items: center; gap: 4px; min-width: 0; height: 36px; margin-top: 10px; padding: 0 0 0 8px; }
  .title { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 650; letter-spacing: -0.015em; color: var(--color-foreground); }
  .actions { display: flex; align-items: center; gap: 4px; flex: none; }
  .actions :global(button.icon) { flex: none; width: 28px; height: 28px; border-radius: var(--radius-md); color: var(--color-subtle); }
  .actions :global(button.icon:hover) { color: var(--color-foreground); }
  /* The one filled button: a new thread is the list's main action. */
  .actions .new.icon { background: var(--color-surface-2); color: var(--color-muted-foreground); }
  @media (max-width: 720px) {
    /* `button.icon` grows to the touch target on a phone. */
    .actions :global(button.icon) { width: var(--touch-target); height: var(--touch-target); }
  }
</style>
