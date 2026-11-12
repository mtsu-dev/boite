<script lang="ts">
  import { ListFilter } from '@lucide/svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { Closing } from '../lib/closing.svelte';
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { strings } from '../lib/strings';
  import type { Project } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import type { AtWork } from './DisplayOptionsPanel.svelte';

  /**
   * The display button over the thread list and the menu it opens
   * (DisplayOptionsPanel.svelte). The menu loads on its own, a moment after
   * the list has drawn, so it stays out of the entry chunk and the first press
   * still opens it at once. It stays open while the user adjusts it; a press
   * outside or Escape puts it away. `filters` counts the filters that hide
   * threads: a dot on the button says one is on, and the line under the head
   * (FilterChips.svelte) names each, so the head never has to fit a name.
   * `word` names the button ("Filter") where the head has the room; the glyph
   * alone keeps the name in its tooltip.
   */
  /** `compact`: the phone's choices only, the project Recent lists and the groups; the order and a project's own switches stay on the desktop. */
  let { entries, target, owner, prefix = '', compact = false, filters = 0, word = false, atWork, onaddproject }: {
    entries: ProjectEntry[]; target: Project | undefined; owner: Store; prefix?: string; compact?: boolean; filters?: number; word?: boolean;
    /** A phone's Recent: the rows at work alone, a filter of the menu's (DisplayOptionsPanel.svelte). */
    atWork?: AtWork;
    onaddproject?: () => void;
  } = $props();

  const spoken = $derived(word ? strings.sidebar.filter : null);

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
  <!-- With words the visible text is its name; the tooltip says what it opens. -->
  <button type="button" class="ghost trigger small" class:icon={!spoken} class:worded={!!spoken} class:filtered={filters > 0} bind:this={trigger} aria-haspopup="dialog" aria-expanded={popover.open}
    aria-label={spoken ? undefined : strings.sidebar.groupingOptions} title={strings.sidebar.groupingOptions} data-testid={`${prefix}grouping-options`} data-view={workspace.view} data-filters={filters} onclick={toggle}>
    <ListFilter size={16} />
    {#if spoken}<span class="word ui-label" data-testid={`${prefix}filter-name`}>{spoken}</span>{/if}
    <!-- A filter on: a dot on the glyph's corner; the line under the head names it. -->
    {#if filters > 0}<span class="dot" aria-hidden="true" data-testid={`${prefix}filter-count`}></span>{/if}
  </button>
  {#if popover.shown && Panel}
    <Panel {popover} anchor={() => trigger ?? null} onclose={close} {entries} {target} {owner} {prefix} {compact} {atWork} {onaddproject} />
  {/if}
</div>

<style>
  .display-options { position: relative; display: inline-flex; max-width: 100%; }
  .trigger { position: relative; }
  .trigger[aria-expanded='true'] { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
  .word { white-space: nowrap; }
  /* A filter on: the selected thing's ink, small on the glyph's corner, ringed off the ground. */
  .dot { position: absolute; top: 5px; left: 17px; width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--color-foreground); box-shadow: 0 0 0 2px var(--color-background); pointer-events: none; }
  .trigger.icon .dot { top: calc(50% - 11px); left: calc(50% + 4px); }
</style>
