<script lang="ts">
  import { tick, type Component } from 'svelte';
  import { Check, ChevronDown, Folder, FolderPlus } from '@lucide/svelte';
  import type { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import { listedName, workspace } from '../lib/workspace.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { projectKey, projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { recentPreferences } from '../lib/recent.svelte';
  import { doneFilter } from '../lib/inbox.svelte';
  import { projectName } from '../lib/format';
  import { strings } from '../lib/strings';
  import type { Project } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import Menu from './Menu.svelte';
  import ProjectTile from './ProjectTile.svelte';

  /**
   * The display menu over the thread list (DisplayOptions.svelte loads it on
   * its own, out of the entry chunk): the view, the project it lists in
   * Recent, the project order, the machine, what folds away, the open
   * project's own switches, then Add a project. It stays open while the user
   * adjusts it; a row's details sit in its tooltip. `target` is the project
   * the project section speaks for, owned by `owner`, which may be another
   * machine's Store.
   */
  let { popover, anchor, onclose, entries, target, owner, prefix = '', compact = false, onaddproject }: {
    popover: Closing;
    anchor: () => HTMLElement | null;
    onclose: (refocus?: boolean) => void;
    entries: ProjectEntry[];
    target: Project | undefined;
    owner: Store;
    prefix?: string;
    /** A phone's menu: the view and the groups only. */
    compact?: boolean;
    /** Given, the menu ends on Add a project. */
    onaddproject?: () => void;
  } = $props();

  let panel = $state<HTMLDivElement>();
  const uid = $props.id();

  const projects = $derived(workspace.view === 'projects');
  const selected = $derived(projectView.selected(entries));
  const machines = $derived(compact ? [] : workspace.machinesOr(owner));
  const shownMachine = $derived(machineFilter.shown(machines));
  const filterItems = $derived([
    { id: 'all', label: strings.sidebar.allProjects, active: !selected },
    ...entries.map(entry => ({ id: projectKey(entry), label: projectName(entry.project), hint: workspace.machines.length > 1 ? entry.machine.label : entry.project.path, active: projectKey(entry) === projectView.filter, projectTile: { project: entry.project, store: entry.machine.store } }))
  ]);
  /** The merged-PR switch is the project's, on cores that know it, for a repository the owner controls. */
  const merged = $derived(!compact && target && owner.owner && target.autoArchiveMergedPr !== undefined && target.repository !== false && target.kind !== 'drafts' ? target : null);
  // Both follow the project on screen: the heading names the project a press writes to, and a lost connection disables it.
  const mergedBusy = $derived(merged ? owner.connection !== 'ready' || owner.projectAutoArchiveMergedPrBusy(merged.id) : true);
  /** The worktree removal switch, beside it on cores that know it. */
  const removal = $derived(merged && merged.autoRemoveWorktrees !== undefined ? merged : null);
  const removalBusy = $derived(removal ? owner.connection !== 'ready' || owner.projectAutoRemoveWorktreesBusy(removal.id) : true);

  $effect(() => {
    if (!popover.open) return;
    // The menu takes the keyboard, so Tab reaches its first row and Escape works, without a ring on a row nobody pointed at.
    void tick().then(() => panel?.focus({ preventScroll: true }));
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && popover.open) {
      event.stopPropagation();
      onclose(true);
      return;
    }
    // Inside a group of choices the arrows move between its options, the radio way.
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'radio') return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const group = [...(event.target.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]') ?? [])];
    const at = group.indexOf(event.target as HTMLButtonElement);
    const next = group[(at + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? group.length - 1 : 1)) % group.length];
    event.preventDefault();
    next?.click();
    next?.focus();
  }
  function setOrder(order: 'recent' | 'manual'): void {
    if (projectView.order !== order) projectView.toggle(entries);
  }
  /** A project picked in Recent on another machine would list nothing under that machine's filter. */
  function pickMachine(id: string | null): void {
    if (id && selected && selected.machine.id !== id) projectView.pick('all');
    machineFilter.set(id);
  }
  /** Focus goes back to the menu's button first, so the form returns there when it closes. */
  function addProject(): void {
    onclose(true);
    onaddproject?.();
  }
</script>

{#snippet choice(value: string, label: string, checked: boolean, onclick: () => void, Glyph?: Component<{ size?: number }>)}
  <button type="button" role="radio" class="row" class:on={checked} aria-checked={checked} tabindex={checked ? 0 : -1} data-value={value} {onclick}>
    {#if Glyph}<span class="glyph" aria-hidden="true"><Glyph size={15} /></span>{/if}<span class="ui-label">{label}</span>
    {#if checked}<span class="check" aria-hidden="true"><Check size={13} /></span>{/if}
  </button>
{/snippet}

{#snippet toggle(value: string, label: string, checked: boolean, hint: string, onclick: () => void, disabled = false)}
  <button type="button" role="switch" class="row" class:on={checked} aria-checked={checked} data-value={value} title={hint} {disabled} {onclick}>
    <span class="ui-label">{label}</span><span class="switch" class:on={checked} aria-hidden="true"></span>
  </button>
{/snippet}

<div
  bind:this={panel}
  class="panel"
  class:closing={popover.closing}
  role="dialog"
  tabindex="-1"
  aria-label={strings.sidebar.groupingOptions}
  data-testid={`${prefix}grouping-options-menu`}
  {onkeydown}
  use:popover.attach
  use:floating={{ anchor, placement: 'bottom', align: 'end', cap: 640, dismiss: () => onclose() }}
  onanimationend={popover.end}
>
  <!-- No view switch here: both views are named in the list's own head (ViewSwitch.svelte). -->
  {#if !projects && !compact && entries.length}
    <!-- The project Recent lists: its own menu, so a long list of projects scrolls there and not here. -->
    <div class="filter">
      <Menu items={filterItems} onpick={key => projectView.pick(key)} label={strings.sidebar.filterProject} placement="bottom" variant="text" testid={`${prefix}project-filter`}>
        {#if selected}<ProjectTile project={selected.project} store={selected.machine.store} size={15} />{:else}<Folder size={15} />{/if}<span class="ui-label">{selected ? projectName(selected.project) : strings.sidebar.allProjects}</span><ChevronDown size={13} />
      </Menu>
    </div>
  {/if}
  {#if projects && entries.length && !compact}
    <div class="separator" role="separator"></div>
    <h3 class="ui-label" id="{uid}-order">{strings.sidebar.displayOrder}</h3>
    <div role="radiogroup" aria-labelledby="{uid}-order" data-testid={`${prefix}project-sort`} data-order={projectView.order}>
      {@render choice('order:recent', strings.sidebar.recentOrder, projectView.order === 'recent', () => setOrder('recent'))}
      {@render choice('order:manual', strings.sidebar.customOrder, projectView.order === 'manual', () => setOrder('manual'))}
    </div>
  {/if}
  {#if machines.length > 1}
    <div class="separator" role="separator"></div>
    <h3 class="ui-label" id="{uid}-machine">{strings.machines.filter}</h3>
    <div role="radiogroup" aria-labelledby="{uid}-machine" data-testid={`${prefix}machine-filter`}>
      {@render choice('machine:all', strings.machines.all, shownMachine === null, () => pickMachine(null))}
      {#each machines as machine (machine.id)}{@render choice(`machine:${machine.id}`, listedName(machine), shownMachine === machine.id, () => pickMachine(machine.id))}{/each}
    </div>
  {/if}
  <div class="separator" role="separator"></div>
  {@render toggle('working', strings.sidebar.groupWorkingRow, recentPreferences.groupWorking, strings.settings.groupWorkingThreadsHint,
    () => recentPreferences.setGroupWorking(!recentPreferences.groupWorking))}
  {@render toggle('done', strings.sidebar.showDoneRow, doneFilter.shown, strings.sidebar.showDoneHint, () => doneFilter.set(!doneFilter.shown))}
  {#if projects}
    {@render toggle('other', strings.sidebar.groupIdleRow, recentPreferences.groupOtherProjects, strings.settings.groupOtherProjectsHint,
      () => recentPreferences.setGroupOtherProjects(!recentPreferences.groupOtherProjects))}
  {/if}
  {#if merged}
    {@const project = merged}
    <div class="separator" role="separator"></div>
    <h3 class="ui-label project"><ProjectTile {project} store={owner} size={13} /><span>{projectName(project)}</span></h3>
    {@render toggle('merged', strings.sidebar.autoArchiveMergedPr, project.autoArchiveMergedPr === true, strings.sidebar.autoArchiveMergedPrHint,
      () => { if (!mergedBusy) void owner.setProjectAutoArchiveMergedPr(project.id, !project.autoArchiveMergedPr); }, mergedBusy)}
    {#if removal}
      {@render toggle('auto-remove-worktrees', strings.sidebar.autoRemoveWorktrees, removal.autoRemoveWorktrees === true, strings.sidebar.autoRemoveWorktreesHint,
        () => { if (!removalBusy) void owner.setProjectAutoRemoveWorktrees(removal.id, !removal.autoRemoveWorktrees); }, removalBusy)}
    {/if}
  {/if}
  {#if onaddproject}
    <div class="separator" role="separator"></div>
    <button type="button" class="row" data-testid="add-project" onclick={addProject}>
      <span class="glyph" aria-hidden="true"><FolderPlus size={15} /></span><span class="ui-label">{strings.sidebar.addProject}</span>
    </button>
  {/if}
</div>

<style>
  /* The app's menu (Menu.svelte): its surface, edge and shadow, at the list's narrow width. */
  .panel {
    width: min(216px, calc(100vw - 24px));
    max-height: min(640px, calc(100dvh - 80px));
    overflow-y: auto;
    padding: 5px;
    display: flex;
    flex-direction: column;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-e2);
    font-size: var(--text-sm);
    z-index: 40;
    animation: pop var(--dur-2) var(--ease-out-quint);
    transform-origin: top right;
    outline: none;
  }
  .panel > * { flex: none; }
  .panel.closing { animation-name: pop-out; pointer-events: none; }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 6px 8px 4px;
    color: var(--color-subtle);
    font-size: var(--text-meta);
    font-weight: 600;
  }
  h3.project span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .separator { height: 1px; margin: 4px 6px; background: var(--color-border); }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    text-align: left;
  }
  .row .ui-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A switch's label may run to two lines rather than lose its end: a project's switches have long names. */
  .row[role='switch'] { height: auto; min-height: 30px; padding-block: 6px; gap: 10px; line-height: 1.3; }
  .row[role='switch'] .ui-label { white-space: normal; }
  .row:hover:not(:disabled), .row:focus-visible { background: var(--color-hover); color: var(--color-foreground); }
  .row:active:not(:disabled) { transform: none; background: var(--color-active); }
  .row:disabled { opacity: 0.55; }
  .row.on[role='radio'] { color: var(--color-foreground); }
  .glyph, .check { display: inline-flex; flex: none; }
  .glyph { color: var(--color-muted-foreground); }
  .row.on .glyph { color: var(--color-foreground); }
  .check { color: var(--color-foreground); }
  /* The app's one switch (app.css), a size down for a menu row. */
  .switch { --switch-width: 26px; --switch-height: 16px; pointer-events: none; }
  /* The first group needs no rule above it. */
  .panel > .separator:first-child { display: none; }
  .filter { padding: 2px 0 0; }
  .filter :global(.menu) { display: flex; min-width: 0; }
  .filter :global(.trigger) { width: 100%; min-width: 0; height: 30px; padding: 0 8px; justify-content: flex-start; gap: 9px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 500; color: var(--color-muted-foreground); }
  .filter :global(.trigger:hover) { color: var(--color-foreground); }
  .filter :global(.trigger .ui-label) { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .filter :global(.trigger svg) { flex: none; }
  @media (prefers-reduced-motion: reduce) { .switch, .switch::after { transition: none; } }
  @media (max-width: 720px) {
    .panel { width: auto; padding: 8px 6px max(8px, env(safe-area-inset-bottom)); }
    .row { height: var(--touch-target); }
  }
</style>
