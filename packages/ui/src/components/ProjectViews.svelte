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
  import PluginSlotButtons from './PluginSlotButtons.svelte';
  import ViewSwitch from './ViewSwitch.svelte';
  import FilterChips from './FilterChips.svelte';
  import { inbox } from '../lib/inbox.svelte';

  /**
   * The thread list's head, one row: its two views, Projects and Recent, as a
   * segmented switch with the side on raised, then the display menu named
   * "Filter", search and "+" for a new thread, its name and key in its tooltip.
   * Recent's project filter and the machine filter live in the display menu,
   * which dots its button while one of them hides threads; each one on is a
   * chip in words on the line under the head, removed with a press.
   */
  /** `quiet`: the first run, no AI and no project yet: the head stays empty, its height kept, so nothing points at an empty list. */
  let { entries, store, quiet = false }: { entries: ProjectEntry[]; store: Store; quiet?: boolean } = $props();
  const selected = $derived(projectView.selected(entries));
  const target = $derived(workspace.view === 'recent' && selected ? selected.project : store.openProject ?? store.projects.find(p => !p.archived));
  const targetOwner = $derived(workspace.view === 'recent' && selected ? selected.machine.store : store);
  const newLabel = $derived(target ? fill(strings.sidebar.newThreadIn, { project: projectName(target) }) : strings.sidebar.newThread);
  /** The filters that hide threads, counted on the display button: the project Recent lists, the machine. */
  const filters = $derived(Number(workspace.view === 'recent' && selected !== undefined) + Number(machineFilter.shown(workspace.machinesOr(store)) !== null));
  const addProject = $derived(store.addsProjects && work.shows('sidebar.add-project') ? () => { store.projectPickerOpen = true; } : undefined);
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
    <!-- The buttons plugin interfaces put in the sidebar, on the machine that loaded them. -->
    {#if store === workspace.primary}<PluginSlotButtons slot="sidebar" threadId={store.openThread?.id ?? null} compact />{/if}
    <DisplayOptions {entries} {target} owner={targetOwner} {filters} word onaddproject={addProject} />
    {#if entries.length}
      <button class="ghost icon small" title={`${strings.sidebar.search}${store.keyHint('palette')}`} aria-label={strings.sidebar.search} data-testid="sidebar-search-open" onclick={() => store.paletteOpen = true}><Search size={16} /></button>
      <button class="ghost icon small" title={`${newLabel}${store.keyHint('new-thread')}`} aria-label={newLabel} data-testid="new-thread" onclick={create}><Plus size={16} /></button>
    {/if}
  </div>
</div>
<FilterChips {entries} owner={store} />
{/if}

<style>
  /* No rule under it: the rows fade out beneath it instead (RailFrame.svelte). The switch starts on the cards' edge. */
  /* The switch keeps its width and 4 px clear of Filter: shrunk, its segment ran under Filter's focus ring. */
  .list-head { display: flex; align-items: center; gap: 4px; min-width: 0; height: 36px; margin-top: 10px; padding: 0; }
  .title { display: flex; flex: 1 0 auto; min-width: 0; margin: 0; font-size: var(--text-sm); font-weight: 500; color: var(--color-foreground); }
  .actions { display: flex; align-items: center; gap: 2px; flex: none; }
  /* A pointer's full 32 px target each. */
  .actions :global(button.icon) { flex: none; width: 32px; height: 32px; border-radius: var(--radius-md); color: var(--color-muted-foreground); }
  .actions :global(button.icon:hover) { color: var(--color-foreground); }
  /* Filter: its glyph and its word, 32 px high as the glyphs beside it. */
  .actions :global(button.worded) { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 8px 0 6px; border-radius: var(--radius-md);
    font-size: var(--text-sm); font-weight: 500; color: var(--color-muted-foreground); white-space: nowrap; }
  .actions :global(button.worded:hover) { color: var(--color-foreground); }
  /* Its ring inside its own edge, as a row's: the 4 px beside the switch stay clear. */
  .actions :global(button.worded:focus-visible) { outline-offset: -2px; }
  /* Too narrow for the word: the glyph alone, the word kept for screen readers. */
  @container sidebar (max-width: 279px) {
    .actions :global(button.worded) { width: 32px; padding: 0; justify-content: center; }
    .actions :global(button.worded .word) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  }
  /* The narrowest column: the views' words keep 4 px sides, so French's "Projets" and "Récent" leave Filter and
     search inside the head at 208 px. */
  @container sidebar (max-width: 239px) {
    .list-head .title :global(.side) { padding: 0 4px; }
  }
  @media (max-width: 720px) {
    /* `button.icon` grows to the touch target on a phone. */
    .actions :global(button.icon) { width: var(--touch-target); height: var(--touch-target); }
  }
</style>
