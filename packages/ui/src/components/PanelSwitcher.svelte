<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  import SearchField from './SearchField.svelte';
  import { Check, ChevronDown, PanelRight, Plus } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import { AnchoredPopover } from '../lib/anchored-popover.svelte';
  import { floating } from '../lib/floating';
  import { panelSwitch } from '../lib/panel-switch.svelte';
  import { menuRows, type MenuItem } from '../lib/menu';

  /**
   * The open panel's door (`PanelDoor.svelte`): its icon and name with a
   * chevron, and the panel launcher it opens. A search first (type to keep the
   * panels whose name or line match, Enter opens the first, Escape closes),
   * then the panels this thread used, then every panel by group, each with
   * its icon, its name and one plain line saying what it holds. It comes with
   * the panel's chunk (`RightPanel.svelte` hands it over), so the entry
   * carries only the closed door, and the search and the lines load on the
   * first open panel. The door styles the face. `add`: a desktop panel's
   * strip draws it as the "+" after its tabs, the launcher the same.
   */
  let { inPanel = false, add = false }: { inPanel?: boolean; add?: boolean } = $props();
  const Glyph = $derived(panelSwitch.glyph ?? PanelRight);

  const popover = new AnchoredPopover(() => root, () => trigger);
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let field = $state<HTMLInputElement>();
  let query = $state('');
  /** The list as it opened: read once per open, so a pick's own effects do not reshuffle it under the pointer. */
  let items = $state.raw<MenuItem[]>([]);

  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  /** The rows that match, each under its section; a section left empty goes with its rows. */
  const shown = $derived.by(() => {
    const needle = fold(query.trim());
    if (!needle) return items;
    const kept: MenuItem[] = [];
    let section: MenuItem | null = null;
    for (const item of items) {
      if (item.separator) { section = item.label ? item : null; continue; }
      if (!fold(`${item.label} ${item.hint ?? ''}`).includes(needle)) continue;
      if (section) { kept.push(section); section = null; }
      kept.push(item);
    }
    return kept;
  });
  const first = $derived(shown.find((item) => !item.separator && !item.disabled));

  function open(): void {
    items = panelSwitch.items();
    query = '';
    popover.show();
    void popover.focusOnOpen(() => root?.querySelector<HTMLElement>('.launcher') ?? undefined, () => field);
  }
  function toggle(event: MouseEvent): void {
    event.stopPropagation();
    if (popover.open) popover.close(false);
    else open();
  }
  function pick(item: MenuItem | undefined): void {
    if (!item || item.disabled) return;
    popover.close();
    panelSwitch.pick(item.id);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popover.close(); return; }
    const list = menuRows(root);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const inField = document.activeElement === field;
    if (event.key === 'Enter' && inField) { event.preventDefault(); pick(first); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || list.length === 0) return;
    // Home and End belong to the field's text while it has any.
    if (inField && (event.key === 'Home' || event.key === 'End')) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && at <= 0) { field?.focus({ preventScroll: true }); return; }
    const next = event.key === 'ArrowDown' ? Math.min(at + 1, list.length - 1) : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : list.length - 1;
    // The focus scrolls a row the cap hid into view.
    list[next]?.focus();
  }
  function onTriggerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' && !popover.open) { event.preventDefault(); open(); }
  }
</script>

<svelte:window onpointerdown={popover.outside} />

<div class="menu door-menu" bind:this={root}>
  {#if add}
  <button type="button" class="trigger ghost small icon" aria-haspopup="dialog" aria-expanded={popover.open} data-testid="panel-add" bind:this={trigger}
    aria-label={strings.rightPanel.launcher} title={strings.rightPanel.launcher} onclick={toggle} onkeydown={onTriggerKey}>
    <Plus size={14} strokeWidth={1.75} />
  </button>
  {:else}
  <button type="button" class="trigger ghost" aria-haspopup="dialog" aria-expanded={popover.open} data-testid="panel-add" bind:this={trigger}
    aria-label={fill(strings.thread.panelSwitch, { name: panelSwitch.title || panelSwitch.name })} title={fill(strings.thread.panelSwitch, { name: panelSwitch.title || panelSwitch.name })}
    onclick={toggle} onkeydown={onTriggerKey}>
    <span class="door-face">
      <Glyph size={16} strokeWidth={1.75} />
      <span class="name ui-label" data-testid={inPanel ? 'panel-title' : 'panel-door-name'}>{panelSwitch.name}</span>
      <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
    </span>
  </button>
  {/if}

  {#if popover.shown}
    <div class="launcher" class:closing={popover.closing} role="dialog" aria-label={strings.thread.panelMenu} tabindex="-1" data-testid="panel-add-menu"
      {onkeydown} use:popover.attach onanimationend={popover.end}
      use:floating={{ anchor: () => trigger ?? null, placement: 'bottom', align: 'end', cap: 640, dismiss: () => popover.close(false) }}>
      <div class="find">
        <SearchField bind:input={field} bind:value={query} placeholder={strings.rightPanel.findPanel} data-testid="panel-find" />
      </div>
      <div class="rows" role="menu" aria-label={strings.thread.panelMenu}>
        {#each shown as item (item.id)}
          {#if item.separator && item.label}
            <div class="section ui-label" role="presentation">{item.label}</div>
          {:else if item.separator}
            <div class="separator" role="separator"></div>
          {:else}
            <button type="button" class="row" class:active={item.active} class:first={!!query.trim() && item === first} role="menuitem" disabled={item.disabled}
              data-row data-value={item.id} data-testid={item.testid} data-preload-view={item.preload} title={item.title} onclick={() => pick(item)}>
              {#if item.glyph}<span class="glyph" aria-hidden="true"><item.glyph size={18} strokeWidth={1.75} /></span>{/if}
              <span class="words">
                <span class="name ui-label">{item.label}</span>
                {#if item.hint}<span class="hint">{item.hint}</span>{/if}
              </span>
              {#if item.active}<span class="check"><Check size={14} aria-hidden="true" /></span>{/if}
            </button>
          {/if}
        {:else}
          <EmptyState compact line={strings.rightPanel.noPanelMatch} testid="panel-find-none" />
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .menu { position: relative; display: inline-flex; }
  .trigger { cursor: pointer; }
  .launcher { position: absolute; top: calc(100% + 6px); right: 0; z-index: 40; display: flex; flex-direction: column; width: min(360px, calc(100vw - 24px)); padding: var(--overlay-pad);
    background: var(--overlay-surface); border: 1px solid var(--overlay-edge); border-radius: var(--radius-overlay); box-shadow: var(--shadow-overlay);
    font-size: var(--text-base); font-weight: 400; animation: pop var(--motion-duration) var(--motion-curve); transform-origin: top right; }
  .launcher.closing { animation: pop-out var(--motion-duration) var(--motion-curve); pointer-events: none; }
  .launcher:focus { outline: none; }
  .find { flex: none; margin: var(--space-1); }
  .rows { display: flex; flex-direction: column; gap: 1px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .rows > * { flex: none; }
  .section { padding: var(--space-3) var(--overlay-row-pad) var(--space-2); font-size: var(--text-meta); font-weight: 600; color: var(--color-subtle); pointer-events: none; }
  .section:first-child { padding-top: var(--space-2); }
  .separator { height: 1px; margin: var(--space-1) var(--overlay-row-pad); background: var(--color-border); }
  .separator:first-child, .separator:last-child, .separator + .separator { display: none; }
  /* A panel's row: its icon, then its name over the line that says what it holds, the showing one checked. */
  /* Its height is its two lines': a button's fixed control height would lay the next row over its hint. */
  .row { display: flex; align-items: center; gap: var(--space-3); height: auto; min-height: var(--overlay-row); padding: 6px var(--overlay-row-pad); border: 0; border-radius: var(--radius-overlay-row);
    background: transparent; color: var(--color-foreground); text-align: left; white-space: normal; }
  @media (hover: hover) { .row:hover:not(:disabled) { background: var(--color-hover); } }
  .row:active:not(:disabled) { background: var(--color-active); }
  /* What Enter opens while a search is typed. */
  .row.first { background: var(--color-hover); }
  .row:disabled { color: var(--color-muted-foreground); }
  .glyph { display: inline-flex; flex: none; color: var(--color-muted-foreground); }
  .row.active .glyph { color: var(--color-foreground); }
  .words { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
  .words .name { font-weight: 500; }
  .hint { font-size: var(--text-sm); color: var(--color-muted-foreground); line-height: 1.3; }
  .check { display: flex; flex: none; color: var(--color-accent); }
  /* A phone sheet: the rows at a finger's height, the search a finger's too. */
  .launcher:global([data-mobile-sheet='true']) { padding-inline: var(--space-2); }
  .launcher:global([data-mobile-sheet='true']) .row { min-height: var(--touch-target); }
</style>
