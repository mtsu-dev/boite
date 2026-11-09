<script lang="ts">
  import { ListFilter } from '@lucide/svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { Closing } from '../lib/closing.svelte';
  import { projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Project } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import type { AtWork } from './DisplayOptionsPanel.svelte';

  /**
   * The display button over the thread list and the menu it opens
   * (DisplayOptionsPanel.svelte). The menu loads on its own, a moment after
   * the list has drawn, so it stays out of the entry chunk and the first press
   * still opens it at once. It stays open while the user adjusts it; a press
   * outside or Escape puts it away. `filters` counts the filters that hide
   * threads, on the button, since the menu that says so is closed: the list's
   * head keeps one row, no chip of its own per filter. `word` names it beside
   * its glyph ("Filter") where the head has the room; the glyph alone keeps
   * the name in its tooltip. A filter on names itself on the button
   * ("Filter: Working"), the others counted after it.
   */
  /** `compact`: the phone's choices only, the project Recent lists and the groups; the order and a project's own switches stay on the desktop. */
  let { entries, target, owner, prefix = '', compact = false, filters = 0, word = false, atWork, onaddproject }: {
    entries: ProjectEntry[]; target: Project | undefined; owner: Store; prefix?: string; compact?: boolean; filters?: number; word?: boolean;
    /** A phone's Recent: the rows at work alone, a filter of the menu's (DisplayOptionsPanel.svelte). */
    atWork?: AtWork;
    onaddproject?: () => void;
  } = $props();

  /** The first filter that hides threads, in the order the menu lists them: at work, the project Recent lists, the machine (a desktop's). */
  const first = $derived.by(() => {
    if (atWork?.on) return strings.sidebar.filterWorking;
    const project = workspace.view === 'recent' ? projectView.selected(entries) : null;
    if (project) return projectName(project.project);
    const list = workspace.machinesOr(owner);
    const id = compact ? null : machineFilter.shown(list);
    return id ? list.find((machine) => machine.id === id)?.label : undefined;
  });
  const named = $derived(first ? fill(strings.sidebar.filterOn, { name: first }) : null);
  /** The words on the button: "Filter" or the filter on where the head has room; a phone's, only a short one ("Working"), as a project's name would not fit and its list heads with it. */
  const spoken = $derived(word ? (named ?? strings.sidebar.filter) : compact && atWork?.on ? strings.sidebar.filterWorking : null);

  const popover = new Closing();
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let Panel = $state.raw<typeof import('./DisplayOptionsPanel.svelte').default>();
  let loading: Promise<void> | undefined;
  function load(): Promise<void> {
    loading ??= import('./DisplayOptionsPanel.svelte').then((module) => { Panel = module.default; }).catch(() => { loading = undefined; popover.hide(); });
    return loading;
  }
  $effect(() => {
    const timer = setTimeout(() => void load(), 1500);
    return () => clearTimeout(timer);
  });

  function toggle(event: MouseEvent): void {
    event.stopPropagation();
    void load();
    popover.toggle();
  }
  function close(refocus = false): void {
    popover.hide();
    if (refocus) trigger?.focus({ preventScroll: true });
  }
  function onWindowPointerdown(event: PointerEvent): void {
    if (!popover.open || (root && event.target instanceof Node && root.contains(event.target))) return;
    // A tooltip or the project list opened from the menu lives in the top layer, outside it.
    if (event.target instanceof Element && event.target.closest('.info-bubble')) return;
    close();
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

<div class="display-options" bind:this={root}>
  <!-- With words the visible text is its name, and a filter on says which; the tooltip says what it opens. -->
  <button type="button" class="ghost trigger small" class:icon={!spoken} class:worded={!!spoken} class:filtered={filters > 0} bind:this={trigger} aria-haspopup="dialog" aria-expanded={popover.open}
    aria-label={spoken ? undefined : (named ?? strings.sidebar.groupingOptions)} title={named ? `${named}. ${strings.sidebar.groupingOptions}` : strings.sidebar.groupingOptions} data-testid={`${prefix}grouping-options`} data-view={workspace.view} onclick={toggle}>
    <ListFilter size={16} />
    {#if spoken}<span class="word ui-label" data-testid={`${prefix}filter-name`}>{spoken}</span>{/if}
    <!-- Beside a named filter, the others as "+N"; otherwise every filter, counted in the corner. -->
    {#if filters > (spoken && named ? 1 : 0)}<span class="count ui-label" class:more={spoken && named} data-testid={`${prefix}filter-count`}>{spoken && named ? `+${filters - 1}` : filters}</span>{/if}
  </button>
  {#if popover.shown && Panel}
    <Panel {popover} anchor={() => trigger ?? null} onclose={close} {entries} {target} {owner} {prefix} {compact} {atWork} {onaddproject} />
  {/if}
</div>

<style>
  .display-options { position: relative; display: inline-flex; max-width: 100%; }
  .trigger { position: relative; }
  .trigger[aria-expanded='true'] { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
  /* A name on the button: at most a project's short name, the full one in the tooltip. */
  .word { min-width: 0; max-width: 14ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Filters on: how many, small in the corner, in the selected thing's ink. */
  .count { position: absolute; top: 1px; right: 1px; min-width: 13px; height: 13px; padding: 0 3px; border-radius: var(--radius-full); background: var(--color-foreground); color: var(--color-background);
    font-size: 9.5px; font-weight: 700; line-height: 13px; text-align: center; font-variant-numeric: tabular-nums; }
  .count.more { position: static; flex: none; min-width: 0; height: auto; padding: 0; background: none; color: var(--color-muted-foreground); font: inherit; line-height: inherit; }
</style>
