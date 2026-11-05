<script lang="ts">
  import { ChevronDown, Plus, Search } from '@lucide/svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { viewMenuItems, pickView } from '../lib/view-menu';
  import { projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import Menu from './Menu.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import RailHead from './RailHead.svelte';
  import DisplayOptions from './DisplayOptions.svelte';

  let { entries, store, prefix = '' }: { entries: ProjectEntry[]; store: Store; prefix?: string } = $props();
  const selected = $derived(projectView.selected(entries));
  const recent = $derived(workspace.view === 'recent');
  const target = $derived(recent && selected ? selected.project : store.openProject ?? store.projects.find(p => !p.archived));
  const targetOwner = $derived(recent && selected ? selected.machine.store : store);
  const newLabel = $derived(target ? fill(strings.sidebar.newThreadIn, { project: projectName(target) }) : strings.sidebar.newThread);
  /** The view first, then, in Recent, the project it lists: one menu in the slot left of the tools. */
  const items = $derived(viewMenuItems(entries, workspace.machines.length > 1));
  /** Always a new draft: one already written stays in the list, where it was. */
  async function create() {
    if (recent && selected) await workspace.select(selected.machine.store, undefined, selected.project.id, { fresh: true });
    else store.startDraft(undefined, { fresh: true });
  }
</script>

<RailHead {store} current="threads" {prefix}>
  {#snippet lead()}
    {#if entries.length}
      <div class="picker">
        <Menu {items} onpick={pickView} label={strings.sidebar.viewPicker} placement="bottom" variant="text" testid={`${prefix}project-filter`}>
          <span class="view ui-label" data-testid={`${prefix}view-name`}>{recent ? strings.sidebar.recentView : strings.sidebar.projectsView}</span
          >{#if recent && selected}<span class="scope"><ProjectTile project={selected.project} store={selected.machine.store} size={14} /><span class="ui-label">{projectName(selected.project)}</span>{#if workspace.machines.length > 1}<span class="machine ui-label">{selected.machine.label}</span>{/if}</span>{/if}<ChevronDown size={12} />
        </Menu>
      </div>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if entries.length}
      <DisplayOptions {entries} {target} owner={targetOwner} {prefix} />
      <button class="ghost icon small" title={`${strings.sidebar.search}${store.keyHint('palette')}`} aria-label={strings.sidebar.search} data-testid={`${prefix}sidebar-search-open`} onclick={() => store.paletteOpen = true}><Search size={16} /></button>
      {#if !prefix}<button class="ghost icon small" title={`${newLabel}${store.keyHint('new-thread')}`} aria-label={newLabel} data-testid="new-thread" onclick={create}><Plus size={16} /></button>{/if}
    {/if}
  {/snippet}
</RailHead>

<style>
  .picker { flex: 1; min-width: 0; }
  .picker :global(.menu) { display: flex; min-width: 0; }
  .picker :global(.trigger) { min-width: 0; max-width: 100%; height: var(--control-sm); justify-content: flex-start; padding: 0 6px; gap: 6px; font-size: var(--text-sm); font-weight: 500; color: var(--color-foreground); }
  .view { flex: none; }
  /* In Recent, the project it is narrowed to follows the view's name, in the muted tier. */
  .scope { display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: var(--color-muted-foreground); }
  .scope::before { content: '·'; margin-right: 1px; }
  .scope span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scope .machine { flex: 0 1 auto; max-width: 40%; font-size: var(--text-xs); }
  .picker :global(svg) { flex: none; }
  .picker :global(.trigger > svg:last-child) { color: var(--color-muted-foreground); }
</style>
