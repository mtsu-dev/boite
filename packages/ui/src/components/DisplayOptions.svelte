<script lang="ts">
  import { Clock, Kanban } from '@lucide/svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { Closing } from '../lib/closing.svelte';
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { strings } from '../lib/strings';
  import type { Project } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';

  /**
   * The display button over the thread list and the menu it opens
   * (DisplayOptionsPanel.svelte). The menu loads on its own, a moment after
   * the list has drawn, so it stays out of the entry chunk and the first press
   * still opens it at once. It stays open while the user adjusts it; a press
   * outside or Escape puts it away. `filtered` marks the button while a filter
   * hides threads, since the menu that says so is closed. Its glyph is the
   * view on (the cards' or Recent's, as the menu draws them), so the list
   * says which one shows before the menu opens.
   */
  /** `compact`: the phone's choices only, the view and the groups; the order and a project's own switches stay on the desktop. */
  let { entries, target, owner, prefix = '', compact = false, filtered = false, onaddproject }: {
    entries: ProjectEntry[]; target: Project | undefined; owner: Store; prefix?: string; compact?: boolean; filtered?: boolean; onaddproject?: () => void;
  } = $props();

  const popover = new Closing();
  const viewName = $derived(workspace.view === 'recent' ? strings.sidebar.recentView : strings.sidebar.projectsView);
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
  <button type="button" class="ghost icon small trigger" class:filtered bind:this={trigger} aria-haspopup="dialog" aria-expanded={popover.open}
    aria-label={strings.sidebar.groupingOptions} title={`${viewName} · ${strings.sidebar.groupingOptions}`} data-testid={`${prefix}grouping-options`} data-view={workspace.view} onclick={toggle}>
    {#if workspace.view === 'recent'}<Clock size={16} />{:else}<Kanban size={16} />{/if}
  </button>
  {#if popover.shown && Panel}
    <Panel {popover} anchor={() => trigger ?? null} onclose={close} {entries} {target} {owner} {prefix} {compact} {onaddproject} />
  {/if}
</div>

<style>
  .display-options { position: relative; display: inline-flex; }
  .trigger { position: relative; }
  .trigger[aria-expanded='true'] { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
  /* A filter on: a small mark in the corner, the selected thing's accent. */
  .trigger.filtered::after { content: ''; position: absolute; top: 4px; right: 4px; width: 5px; height: 5px; border-radius: var(--radius-full); background: var(--color-foreground); }
</style>
