<script module lang="ts">
  /** A phone's Recent filter on the rows at work: how many there are, whether it is on, and its switch. */
  export type AtWork = { count: number; on: boolean; toggle: () => void };
</script>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { Archive, Check, ChevronDown, ChevronRight, Folder, FolderPlus, Layers } from '@lucide/svelte';
  import type { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import { listedName, workspace } from '../lib/workspace.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { projectKey, projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { recentPreferences } from '../lib/recent.svelte';
  import { doneFilter } from '../lib/inbox.svelte';
  import { projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Project } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import Menu from './Menu.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import MachineIcon from './MachineIcon.svelte';
  import { openArchived } from '../lib/archived-view.svelte';

  /**
   * The display menu over the thread list (DisplayOptions.svelte loads it on
   * its own, out of the entry chunk), one named group after another, each a
   * label over rows of one height: the project Recent lists, the project
   * order, the machine, what the list folds away (Display), the open project's
   * own switches, then the two ways out of the list on its last lines, the
   * archive and Add a project. It stays open while the user adjusts it; a
   * row's details sit in its tooltip. `target` is the project
   * the project section speaks for, owned by `owner`, which may be another
   * machine's Store.
   */
  let { popover, anchor, onclose, entries, target, owner, prefix = '', compact = false, atWork, onaddproject }: {
    popover: Closing;
    anchor: () => HTMLElement | null;
    onclose: (refocus?: boolean) => void;
    entries: ProjectEntry[];
    target: Project | undefined;
    owner: Store;
    prefix?: string;
    /** A phone's menu: the project Recent lists and the groups only. */
    compact?: boolean;
    atWork?: AtWork;
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
  /** The archive takes the list's place (a page of its own on a phone), on the project Recent lists when one is picked. */
  function showArchived(): void {
    onclose();
    if (selected && !projects) openArchived(selected.machine.store, selected.project.id);
    else openArchived(owner);
  }
</script>

{#snippet choice(value: string, label: string, checked: boolean, onclick: () => void, glyph?: Snippet)}
  <button type="button" role="radio" class="row" class:on={checked} aria-checked={checked} tabindex={checked ? 0 : -1} data-value={value} {onclick}>
    {#if glyph}<span class="glyph" aria-hidden="true">{@render glyph()}</span>{/if}<span class="ui-label">{label}</span>
    <span class="check" aria-hidden="true">{#if checked}<Check size={14} />{/if}</span>
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
  {#if !projects && entries.length}
    <!-- The project Recent lists: its own menu, so a long list of projects scrolls there and not here. -->
    <section class="group">
      <h3 class="ui-label">{strings.sidebar.filterProject}</h3>
      <div class="filter">
        <Menu items={filterItems} onpick={key => projectView.pick(key)} label={strings.sidebar.filterProject} placement="bottom" variant="text" testid={`${prefix}project-filter`}>
          <span class="glyph">{#if selected}<ProjectTile project={selected.project} store={selected.machine.store} size={16} />{:else}<Folder size={16} />{/if}</span><span class="ui-label">{selected ? projectName(selected.project) : strings.sidebar.allProjects}</span><ChevronDown size={14} />
        </Menu>
      </div>
    </section>
  {/if}
  {#if projects && entries.length && !compact}
    <section class="group">
      <h3 class="ui-label" id="{uid}-order">{strings.sidebar.displayOrder}</h3>
      <div role="radiogroup" aria-labelledby="{uid}-order" data-testid={`${prefix}project-sort`} data-order={projectView.order}>
        {@render choice('order:recent', strings.sidebar.recentOrder, projectView.order === 'recent', () => setOrder('recent'))}
        {@render choice('order:manual', strings.sidebar.customOrder, projectView.order === 'manual', () => setOrder('manual'))}
      </div>
    </section>
  {/if}
  {#if machines.length > 1}
    <section class="group">
      <h3 class="ui-label" id="{uid}-machine">{strings.machines.filter}</h3>
      <div role="radiogroup" aria-labelledby="{uid}-machine" data-testid={`${prefix}machine-filter`}>
        {#snippet every()}<Layers size={16} />{/snippet}
        {@render choice('machine:all', strings.machines.all, shownMachine === null, () => pickMachine(null), every)}
        {#each machines as machine (machine.id)}
          {#snippet glyph()}<MachineIcon icon={machine.icon} os={machine.store.core?.os} size={16} />{/snippet}
          {@render choice(`machine:${machine.id}`, listedName(machine), shownMachine === machine.id, () => pickMachine(machine.id), glyph)}
        {/each}
      </div>
    </section>
  {/if}
  <section class="group">
    <h3 class="ui-label">{strings.sidebar.filterDisplay}</h3>
    {#if atWork && atWork.count > 0}
      <button type="button" role="switch" class="row" class:on={atWork.on} aria-checked={atWork.on} data-value="at-work" data-testid={`${prefix}at-work`} title={strings.mobile.atWorkFilter} onclick={atWork.toggle}>
        <span class="ui-label">{fill(strings.mobile.atWork, { count: String(atWork.count) })}</span><span class="switch" class:on={atWork.on} aria-hidden="true"></span>
      </button>
    {/if}
    {@render toggle('working', strings.sidebar.groupWorkingRow, recentPreferences.groupWorking, strings.settings.groupWorkingThreadsHint,
      () => recentPreferences.setGroupWorking(!recentPreferences.groupWorking))}
    {@render toggle('done', strings.sidebar.showDoneRow, doneFilter.shown, strings.sidebar.showDoneHint, () => doneFilter.set(!doneFilter.shown))}
    {#if projects}
      {@render toggle('other', strings.sidebar.groupIdleRow, recentPreferences.groupOtherProjects, strings.settings.groupOtherProjectsHint,
        () => recentPreferences.setGroupOtherProjects(!recentPreferences.groupOtherProjects))}
    {/if}
  </section>
  {#if merged}
    {@const project = merged}
    <section class="group">
      <h3 class="ui-label project"><ProjectTile {project} store={owner} size={14} /><span>{projectName(project)}</span></h3>
      {@render toggle('merged', strings.sidebar.autoArchiveMergedPr, project.autoArchiveMergedPr === true, strings.sidebar.autoArchiveMergedPrHint,
        () => { if (!mergedBusy) void owner.setProjectAutoArchiveMergedPr(project.id, !project.autoArchiveMergedPr); }, mergedBusy)}
      {#if removal}
        {@render toggle('auto-remove-worktrees', strings.sidebar.autoRemoveWorktrees, removal.autoRemoveWorktrees === true, strings.sidebar.autoRemoveWorktreesHint,
          () => { if (!removalBusy) void owner.setProjectAutoRemoveWorktrees(removal.id, !removal.autoRemoveWorktrees); }, removalBusy)}
      {/if}
    </section>
  {/if}
  <!-- The ways out of the list: the archive, which takes the list's place, and a new project. -->
  {#if entries.length || onaddproject}
  <section class="group">
    {#if entries.length}
      <button type="button" class="row" data-testid={`${prefix}archived-entry`} onclick={showArchived}>
        <span class="glyph" aria-hidden="true"><Archive size={16} /></span><span class="ui-label">{strings.settings.archived.heading}</span><span class="check" aria-hidden="true"><ChevronRight size={14} /></span>
      </button>
    {/if}
    {#if onaddproject}
      <button type="button" class="row" data-testid="add-project" onclick={addProject}>
        <span class="glyph" aria-hidden="true"><FolderPlus size={16} /></span><span class="ui-label">{strings.sidebar.addProject}</span>
      </button>
    {/if}
  </section>
  {/if}
</div>

<style>
  /* The app's menu (Menu.svelte): its surface, edge and shadow. Groups of rows, each under its label, a hairline
     between two groups; every row 32 px with the same 10 px sides, its glyph in a 16 px slot, its mark or switch
     at the right end. */
  .panel {
    width: min(256px, calc(100vw - 24px));
    max-height: min(640px, calc(100dvh - 80px));
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    font-size: var(--text-sm);
    z-index: 40;
    animation: pop var(--dur-2) var(--ease-out-quint);
    transform-origin: top right;
    outline: none;
  }
  .panel > * { flex: none; }
  .panel.closing { animation-name: pop-out; pointer-events: none; }
  .group { display: flex; flex-direction: column; gap: 1px; }
  .group + .group { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--color-border); }
  /* A group's label: a step under the rows in size and ink, on the rows' text edge. */
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 6px 10px 4px;
    color: var(--color-muted-foreground);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  h3.project span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    text-align: left;
    transition: background var(--dur-1) var(--ease-out-quint);
  }
  .row .ui-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A switch's label may run to two lines rather than lose its end: a project's switches have long names. */
  .row[role='switch'] { height: auto; min-height: 32px; padding-block: 6px; line-height: 1.3; }
  .row[role='switch'] .ui-label { white-space: normal; }
  .row:hover:not(:disabled), .row:focus-visible { background: var(--color-hover); }
  .row:active:not(:disabled) { transform: none; background: var(--color-active); }
  .row:disabled { opacity: 0.55; }
  /* The picked choice shows by its fill and its tick. */
  .row.on[role='radio'] { background: var(--color-active); }
  .glyph, .check { display: inline-flex; flex: none; align-items: center; justify-content: center; }
  .glyph { width: 16px; color: var(--color-muted-foreground); }
  .row.on .glyph, .row:hover .glyph { color: var(--color-foreground); }
  .check { width: 14px; color: var(--color-muted-foreground); }
  .row.on .check { color: var(--color-foreground); }
  /* The app's one switch (app.css), a size down for a menu row. */
  .switch { --switch-width: 28px; --switch-height: 16px; flex: none; pointer-events: none; }
  /* The project picker reads as a row of the menu: same height, sides and glyph slot, its chevron at the end. */
  .filter :global(.menu) { display: flex; min-width: 0; }
  .filter :global(.trigger) { width: 100%; min-width: 0; height: 32px; padding: 0 10px; justify-content: flex-start; gap: 10px; border-radius: var(--radius-overlay-row); font-size: var(--text-sm); font-weight: 500; color: var(--color-foreground); background: var(--color-hover); }
  .filter :global(.trigger:hover) { background: var(--color-active); }
  .filter :global(.trigger .ui-label) { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .filter :global(.trigger svg) { flex: none; color: var(--color-muted-foreground); }
  @media (prefers-reduced-motion: reduce) { .row, .switch, .switch::after { transition: none; } }
  @media (max-width: 720px) {
    .panel { width: auto; padding: 8px 6px max(8px, env(safe-area-inset-bottom)); }
    .row, .filter :global(.trigger) { height: var(--touch-target); }
    .row[role='switch'] { min-height: var(--touch-target); }
  }
</style>
