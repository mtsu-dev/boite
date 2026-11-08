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
   * threads, on the button, since the menu that says so is closed: the list's
   * head keeps one row, no chip of its own per filter. A glyph alone: the
   * view on is named beside it (ViewSwitch.svelte).
   */
  /** `compact`: the phone's choices only, the project Recent lists and the groups; the order and a project's own switches stay on the desktop. */
  let { entries, target, owner, prefix = '', compact = false, filters = 0, atWork, onaddproject }: {
    entries: ProjectEntry[]; target: Project | undefined; owner: Store; prefix?: string; compact?: boolean; filters?: number;
    /** A phone's Recent: the rows at work alone, a filter of the menu's (DisplayOptionsPanel.svelte). */
    atWork?: AtWork;
    onaddproject?: () => void;
  } = $props();

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
  <button type="button" class="ghost trigger icon small" class:filtered={filters > 0} bind:this={trigger} aria-haspopup="dialog" aria-expanded={popover.open}
    aria-label={strings.sidebar.groupingOptions} title={strings.sidebar.groupingOptions} data-testid={`${prefix}grouping-options`} data-view={workspace.view} onclick={toggle}>
    <ListFilter size={16} />{#if filters > 0}<span class="count ui-label" data-testid={`${prefix}filter-count`}>{filters}</span>{/if}
  </button>
  {#if popover.shown && Panel}
    <Panel {popover} anchor={() => trigger ?? null} onclose={close} {entries} {target} {owner} {prefix} {compact} {atWork} {onaddproject} />
  {/if}
</div>

<style>
  .display-options { position: relative; display: inline-flex; max-width: 100%; }
  .trigger { position: relative; }
  .trigger[aria-expanded='true'] { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
  /* Filters on: how many, small in the corner, in the selected thing's ink. */
  .count { position: absolute; top: 1px; right: 1px; min-width: 13px; height: 13px; padding: 0 3px; border-radius: var(--radius-full); background: var(--color-foreground); color: var(--color-background);
    font-size: 9.5px; font-weight: 700; line-height: 13px; text-align: center; font-variant-numeric: tabular-nums; }
</style>
