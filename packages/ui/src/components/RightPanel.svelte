<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { ArrowRightToLine, ChevronLeft, ChevronRight, Ellipsis, ListX, Maximize2, Minimize2, SquareX, X, GripHorizontal, PanelsTopLeft } from '@lucide/svelte';
  import { PanelCounts, PRIMARY, stripItems } from '../lib/panel-strip.svelte';
  import { launcherItems, panelAvailable, pickLauncher } from '../lib/panel-launcher';
  import { floatingPanel, RESIZE_DIRECTIONS } from '../lib/floating-panel';
  import { StripScroll } from '../lib/strip-scroll.svelte';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { longPress } from '../lib/long-press';
  import { controlMenu, CONTROLS_SECTION } from '../lib/controls';
  import type { ControlId } from '../lib/work-prefs.svelte';
  import { separator } from '../lib/menu';
  import { closeTabs } from '../lib/panel-close';
  import { innerWidth } from 'svelte/reactivity/window';
  import { clampPanel, panelSibling, rightPanel } from '../lib/right-panel.svelte';
  import type { BoundPanel, Surface, SurfaceKind } from '../lib/right-panel.svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { offeredCards, kindName, label, tooltip } from '../lib/surface-labels';
  import Menu from './Menu.svelte';
  import PanelResizeHandle from './PanelResizeHandle.svelte';
  import SurfaceIcon from './SurfaceIcon.svelte';
    import PanelSurfaceView from './PanelSurfaceView.svelte';
  import PanelPhoneHeader from './PanelPhoneHeader.svelte';

  let {
    store,
    panel,
    closing = false,
    attach,
    onexit
  }: {
    store: Store;
    panel: BoundPanel;
    /** Set by `App.svelte` while the panel plays its exit, just before it unmounts. */
    closing?: boolean;
    attach: (node: HTMLElement) => { destroy: () => void };
    onexit: (event: AnimationEvent) => void;
  } = $props();

  const phone = $derived((innerWidth.current ?? window.innerWidth) <= 720);
  /**
   * The docked width: the one asked for, within the room the chat keeps once
   * the thread list and the contacts column take theirs. The asked width stays
   * stored for when the room comes back.
   */
  const docked = $derived(clampPanel(rightPanel.width, innerWidth.current ?? window.innerWidth, panelSibling(store, innerWidth.current ?? window.innerWidth)));
  /** The new-surface menu's last row, which no surface kind can be called. */
  const CUSTOMIZE = 'customize';

  let tabs = $state<HTMLDivElement | undefined>(undefined);
  let root = $state<HTMLElement | undefined>(undefined);
  let dragging = $state(false);
  let near = $state(false);
  /**
   * Off while the panel slides in: its tabs and surface arrive with it, and
   * their own entrances would add a second movement on top. A tab opened or
   * picked after that plays its own.
   */
  let entered = $state(false);

  function onanimationend(event: AnimationEvent): void {
    if (event.target === event.currentTarget && !closing) entered = true;
    onexit(event);
  }

  /** Detached to float mid-slide, the entrance is cancelled rather than ended. */
  function onanimationcancel(event: AnimationEvent): void {
    if (event.target === event.currentTarget && !closing) entered = true;
  }

  // A floating panel, reduced motion past its frame, or a test environment has
  // no entrance whose end could say so.
  onMount(() => {
    if (!root || typeof root.getAnimations !== 'function' || root.getAnimations().length === 0) entered = true;
    // Svelte's element types have no `onanimationcancel` attribute.
    const node = root;
    node?.addEventListener('animationcancel', onanimationcancel);
    return () => node?.removeEventListener('animationcancel', onanimationcancel);
  });

  /**
   * `use:` on a tab or a surface: one created once the panel is in plays its
   * entrance. Decided at creation, so the panel landing does not replay the
   * entrance of what came in with it. An attribute, since Svelte rewrites the
   * class list whenever `class:active` changes.
   */
  function arrive(node: HTMLElement): void {
    if (untrack(() => entered)) node.dataset.arriving = '';
  }

  let surfaces = $derived(panel.surfaces);
  let active = $derived(panel.active);
  let empty = $derived(surfaces.length === 0);

  /** The user's own browser needs the shell's webview, or the iframe a test page paints. */
  function available(kind: SurfaceKind): boolean {
    return panelAvailable(store, kind);
  }

  /** The strip's overflow, its hidden ends and the chevrons that scroll it (`lib/strip-scroll.svelte.ts`). */
  const scroller = new StripScroll(() => tabs, () => surfaces.length);

  // The tab that is showing is always the one in view, also once the chevrons
  // that an overflow brings have narrowed the strip under it.
  $effect(() => {
    const id = panel.activeSurfaceId;
    void scroller.overflowing;
    if (!id || !tabs) return;
    const tab = tabs.querySelector<HTMLElement>(`[data-surface-id="${CSS.escape(id)}"]`);
    // jsdom has no layout, so it has no `scrollIntoView` either.
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });

  /** The X shuts the panel and hands the keys to the title bar's toggle that opens it again; clicked, it left them on the page. */
  function shut(): void {
    panel.hide();
    if (!phone) document.querySelector<HTMLElement>('[data-testid="panel-toggle"]')?.focus({ preventScroll: true });
  }

  function openTabMenu(event: MouseEvent, surface: Surface): void {
    const index = surfaces.findIndex((one) => one.id === surface.id);
    contextMenu.open(
      event,
      [
        { id: 'close', label: strings.common.close, glyph: X },
        { id: 'others', label: strings.rightPanel.closeOthers, glyph: ListX, disabled: surfaces.length < 2 },
        {
          id: 'right',
          label: strings.rightPanel.closeToRight,
          glyph: ArrowRightToLine,
          disabled: index < 0 || index === surfaces.length - 1
        },
        separator(),
        { id: 'all', label: strings.rightPanel.closeAll, glyph: SquareX }
      ],
      (action) => {
        if (action === 'close' || action === 'others' || action === 'right' || action === 'all') {
          void closeTabs(panel, action, surface.id);
        }
      }
    );
  }

  function onTabPointerDown(event: MouseEvent, surface: Surface): void {
    if (event.button !== 1) return;
    // The middle button scrolls by default; the tab closes instead.
    event.preventDefault();
    void closeTabs(panel, 'close', surface.id);
  }

  function onTabKey(event: KeyboardEvent, surface: Surface): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      panel.activate(surface.id);
    }
  }

  /** The arrows walk the strip, the way a tablist is expected to answer them. */
  function onTabsKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const node = tabs;
    if (!node) return;
    const list = Array.from(node.querySelectorAll<HTMLElement>('[role="tab"]'));
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (list.length === 0 || index < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    list[(index + step + list.length) % list.length]?.focus();
  }

  function launch(kind: SurfaceKind): void {
    // A key reaches this with no card to disable, and a surface a paired device
    // may not read would open empty.
    if (!available(kind)) return;
    panel.open(kind);
  }

  /** A card's letter while the launcher shows and the panel has the pointer or the focus. */
  function onWindowKey(event: KeyboardEvent): void {
    if (!empty || !near) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    const card = offeredCards().find((one) => one.key.toLowerCase() === key);
    if (!card) return;
    event.preventDefault();
    launch(card.kind);
  }

  /** The strip's fixed kinds first, open or not, then the other open surfaces; with their counts (`lib/panel-strip.svelte.ts`). */
  let strip = $derived(stripItems(surfaces, available));
  const counts = new PanelCounts(() => store);

  /** What More lists: the drawers under the chat, then the surfaces past the strip's five, then the way back to a kind put away. */
  let menuItems = $derived([
    ...launcherItems(store, (kind) => counts.of(kind), null, { primary: false }),
    separator('sep-customize'),
    { id: CUSTOMIZE, label: strings.controls.customize }
  ]);

  /** A tab's accessible name: the surface, then what its count says ("Changes, 6 files"). */
  function named(name: string, count: { label: string } | null): string {
    return count ? `${name}, ${count.label}` : name;
  }

  /**
   * Every tab keeps its name while the five fit; past that the ones behind
   * the front tab give way to their icon and count, never to a cut word. A
   * hidden copy of the full strip measures the room it needs.
   */
  let header = $state<HTMLElement | undefined>(undefined);
  let measure = $state<HTMLDivElement | undefined>(undefined);
  let spacer = $state<HTMLSpanElement | undefined>(undefined);
  let compact = $state(false);
  function fit(): void {
    // jsdom lays nothing out: no room means no measure.
    if (!measure || !tabs || !spacer || tabs.clientWidth + spacer.clientWidth === 0) return;
    compact = measure.scrollWidth > tabs.clientWidth + spacer.clientWidth - 4;
  }
  $effect(() => {
    void strip; void counts.of('changes'); void counts.atWork; void panel.activeSurfaceId; void strings.rightPanel.changes;
    if (!header) return;
    void tick().then(fit);
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(header);
    return () => observer.disconnect();
  });

  function pickNew(id: string): void {
    if (id === CUSTOMIZE) store.showSettings('appearance', CONTROLS_SECTION);
    else pickLauncher(store, id);
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<button
  type="button"
  class="sheet-scrim"
  class:floating={rightPanel.floating}
  class:closing
  aria-label={strings.common.close}
  onclick={() => panel.toggle()}
></button>

<aside
  class="panel framed"
  class:maximized={rightPanel.maximized}
  class:floating={rightPanel.floating}
  class:dragging
  class:closing
  class:entered
  style="--panel-width: {docked}px"
  data-testid="right-panel"
  bind:this={root}
  use:attach
  use:floatingPanel={{ enabled: rightPanel.floating, maximized: rightPanel.maximized }}
  {onanimationend}
  onpointerenter={() => (near = true)}
  onpointerleave={() => (near = false)}
  onfocusin={() => (near = true)}
  onfocusout={(event) => {
    if (!root?.contains(event.relatedTarget as Node | null)) near = false;
  }}
>
  {#if !rightPanel.floating}<PanelResizeHandle {store} bind:dragging />{/if}

  <header class="strip" data-panel-move data-testid="panel-titlebar" bind:this={header}>
    {#if rightPanel.floating}
      <button type="button" class="ghost small icon move-handle" data-panel-move data-testid="panel-move"
        title={strings.browser.move} aria-label={strings.browser.move} disabled={rightPanel.maximized}>
        <GripHorizontal size={16} />
      </button>
    {/if}
    {#if phone}
      <PanelPhoneHeader {store} {panel} {counts} onback={shut} />
    {:else}
    {#if scroller.overflowing}
      <button
        type="button"
        class="ghost small icon chev"
        title={strings.rightPanel.scrollLeft}
        aria-label={strings.rightPanel.scrollLeft}
        disabled={!scroller.hiddenStart}
        onclick={() => scroller.scrollBy(-1)}
      >
        <ChevronLeft size={14} strokeWidth={1.75} />
      </button>
    {/if}

    <div
      class="tabs"
      class:compact
      class:hidden-start={scroller.overflowing && scroller.hiddenStart}
      class:hidden-end={scroller.overflowing && scroller.hiddenEnd}
      role="tablist"
      tabindex="-1"
      bind:this={tabs}
      onwheel={scroller.onwheel}
      onscroll={scroller.readEdges}
      onkeydown={onTabsKey}
      data-testid="panel-tabs"
    >
      {#each strip as item (item.key)}
        {@const count = counts.of(item.kind)}
        {#if item.surface}
        {@const surface = item.surface}
        <div
          class="tab"
          use:arrive
          class:active={surface.id === panel.activeSurfaceId}
          role="tab"
          tabindex="0"
          aria-selected={surface.id === panel.activeSurfaceId}
          aria-label={named(label(surface), count)}
          data-surface-id={surface.id}
          data-kind={surface.kind}
          data-testid="panel-tab"
          title={named(tooltip(surface), count)}
          onclick={() => panel.activate(surface.id)}
          onkeydown={(event) => onTabKey(event, surface)}
          onmousedown={(event) => onTabPointerDown(event, surface)}
          oncontextmenu={(event) => openTabMenu(event, surface)}
          use:longPress
        >
          <button
            type="button"
            class="closer"
            aria-label={fill(strings.rightPanel.closeTab, { title: label(surface) })}
            data-testid="panel-tab-close"
            onclick={(event) => {
              event.stopPropagation();
              void closeTabs(panel, 'close', surface.id);
            }}
          >
            <span class="glyph">
              <SurfaceIcon kind={surface.kind} size={14} />
            </span>
            <span class="cross"><X size={14} strokeWidth={2} /></span>
          </button>
          <span class="name ui-label">{label(surface)}</span>
          {#if count}<span class="count" aria-hidden="true">{count.value}</span>{/if}
        </div>
        {:else}
        <!-- A surface not open yet keeps its place in the strip: one click opens it. -->
        <button
          type="button"
          class="tab kind"
          role="tab"
          aria-selected="false"
          aria-label={named(kindName(item.kind), count)}
          data-kind={item.kind}
          data-testid="panel-kind"
          title={named(kindName(item.kind), count)}
          onclick={() => launch(item.kind)}
          oncontextmenu={(event) => controlMenu(event, store, `panel.${item.kind}` as ControlId)}
        >
          <span class="glyph"><SurfaceIcon kind={item.kind} size={14} /></span>
          <span class="name ui-label">{kindName(item.kind)}</span>
          {#if count}<span class="count" aria-hidden="true">{count.value}</span>{/if}
        </button>
        {/if}
      {/each}
    </div>
    <!-- The full strip, unseen: the room every name needs, which decides `compact`. -->
    <div class="tabs measure" aria-hidden="true" bind:this={measure}>
      {#each strip as item (item.key)}
        {@const count = counts.of(item.kind)}
        <span class="tab kind" class:active={item.surface !== undefined && item.surface.id === panel.activeSurfaceId}>
          {#if item.surface && item.surface.id === panel.activeSurfaceId}<span class="closer"></span>{/if}
          <span class="name ui-label">{item.surface ? label(item.surface) : kindName(item.kind)}</span>
          {#if count}<span class="count">{count.value}</span>{/if}
        </span>
      {/each}
    </div>

    {#if scroller.overflowing}
      <button
        type="button"
        class="ghost small icon chev"
        title={strings.rightPanel.scrollRight}
        aria-label={strings.rightPanel.scrollRight}
        disabled={!scroller.hiddenEnd}
        onclick={() => scroller.scrollBy(1)}
      >
        <ChevronRight size={14} strokeWidth={1.75} />
      </button>
    {/if}

    <!-- The drawers under the chat, every other surface, and the way back to a kind this device put away. -->
    <span class="more">
      <Menu
        items={menuItems}
        onpick={pickNew}
        placement="bottom"
        align="end"
        variant="ghost"
        label={strings.rightPanel.more}
        testid="panel-add"
      >
        <Ellipsis size={14} strokeWidth={1.75} />
      </Menu>
    </span>

    <span class="spacer" bind:this={spacer}></span>

    {#if rightPanel.floating}
      <button type="button" class="ghost small icon" data-testid="panel-dock"
        title={strings.browser.dock} aria-label={strings.browser.dock}
        onclick={() => { rightPanel.floating = false; rightPanel.maximized = false; }}>
        <PanelsTopLeft size={14} strokeWidth={1.75} />
      </button>
    {/if}

    <button
      type="button"
      class="ghost small icon maximize"
      title={rightPanel.maximized ? strings.rightPanel.restore : strings.rightPanel.maximize}
      aria-label={rightPanel.maximized ? strings.rightPanel.restore : strings.rightPanel.maximize}
      aria-pressed={rightPanel.maximized}
      data-testid="panel-maximize"
      onclick={() => (rightPanel.maximized = !rightPanel.maximized)}
    >
      {#if rightPanel.maximized}
        <Minimize2 size={14} strokeWidth={1.75} />
      {:else}
        <Maximize2 size={14} strokeWidth={1.75} />
      {/if}
    </button>
    <button
      type="button"
      class="ghost small icon panel-close"
      title={strings.common.close}
      aria-label={strings.common.close}
      data-testid="panel-close"
      onclick={shut}
    >
      <X size={14} strokeWidth={1.75} />
    </button>
    {/if}
  </header>

  <div class="body">
    <!-- Keyed on the tab, so picking another one fades its surface in rather
         than swapping it in one frame, the way a settings page arrives. -->
    {#key active?.id}
    <div class="surface" use:arrive>
    <PanelSurfaceView {store} {panel} {active} {available} onlaunch={launch} />
    </div>
    {/key}
  </div>
  {#if rightPanel.floating && !rightPanel.maximized}
    {#each RESIZE_DIRECTIONS as direction}
      <button type="button" class="float-resize" data-panel-resize={direction} data-testid={`panel-resize-${direction}`}
        aria-label={strings.rightPanel.resize}></button>
    {/each}
  {/if}
</aside>

<style>
  .panel {
    position: relative;
    width: var(--panel-width);
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    /* A framed card whose resize handle hangs out into the gap beside it, so
       the card itself does not clip: its body rounds the bottom corners. */
    overflow: visible;
    /* It comes in from the window's right edge and the chat narrows with it,
       at its own width all along, so nothing inside rewraps on the way. */
    --slide-room: calc(var(--panel-width) + var(--frame-gap));
    animation: slide-left var(--dur-slide) var(--ease-slide);
  }

  .panel.closing {
    animation: slide-right-out var(--dur-slide-out) var(--ease-slide);
    pointer-events: none;
  }

  /* Maximized, it already fills the room the chat leaves: it fades in place. */
  .panel.maximized {
    animation: fade var(--dur-3) var(--ease-out-quint);
  }

  .panel.maximized.closing {
    animation: fade-out var(--dur-2) var(--ease-out-quint);
  }

  .panel.maximized {
    width: auto;
    flex: 1;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 44px;
    padding: 0 8px 0 8px;
    border-bottom: 1px solid var(--color-border);
    flex: none;
    min-width: 0;
    /* The panel's width decides which labels the strip can afford. */
    container: strip / inline-size;
  }

  /* The strip's controls are as tall as its tabs. */
  .strip button.small.icon,
  .strip :global(.trigger.ghost) {
    height: var(--control-sm);
    width: var(--control-sm);
  }

  /* Only the tabs give way. A control that shrank too took part of the room the
     chevrons cost, so the tabs lost less than `measure` counted and the
     chevrons went and came back on every frame at the panel's narrowest. */
  .strip > :not(.tabs, .spacer) {
    flex: none;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    scroll-behavior: smooth;
    /* A tab brought into view clears the end fade too, not only the edge. */
    scroll-padding-inline: 28px;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tabs.hidden-start { mask-image: linear-gradient(to right, transparent, black 24px); }
  .tabs.hidden-end { mask-image: linear-gradient(to left, transparent, black 24px); }
  .tabs.hidden-start.hidden-end { mask-image: linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent); }

  .tab {
    display: flex;
    align-items: center;
    gap: 2px;
    height: var(--control-sm);
    max-width: 144px;
    flex: none;
    padding: 0 8px 0 5px;
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    cursor: pointer;
    user-select: none;
    transition:
      background var(--dur-2) var(--ease-out-quint),
      color var(--dur-2) var(--ease-out-quint);
  }

  /* A new tab opens from its left edge into the strip, the way the strip reads. */
  .tab:global([data-arriving]) {
    animation: tab-in var(--dur-3) var(--ease-out-quint);
  }

  @keyframes tab-in {
    from {
      opacity: 0;
      transform: translateX(-6px);
    }
  }

  .tab:hover {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  .tab.active {
    background: var(--color-active);
    color: var(--color-foreground);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .closer {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    flex: none;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
  }

  .closer:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-foreground) 12%, transparent);
  }

  .closer:active:not(:disabled) {
    transform: none;
    background: color-mix(in srgb, var(--color-foreground) 22%, transparent);
  }

  .cross {
    display: none;
  }

  /* Flex, not inline: an inline span set the icon on the text's baseline, 2.5 px above the label's centre. */
  .glyph {
    display: inline-flex;
  }

  .glyph,
  .cross {
    align-items: center;
    justify-content: center;
  }

  /* The surface's own icon is the close target: it turns into an X under the
     pointer, and under the keyboard too as soon as the tab holds the focus. */
  .tab:hover .glyph,
  .tab:focus-within .glyph,
  .closer:focus-visible .glyph {
    display: none;
  }

  .tab:hover .cross,
  .tab:focus-within .cross,
  .closer:focus-visible .cross {
    display: inline-flex;
  }

  /* A surface not open yet, and the drawers under the chat: a plain button that
     reads like a tab, its icon never turning into a close cross. */
  .tab.kind {
    gap: 5px;
    padding: 0 8px;
    min-height: 0;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: var(--text-xs);
  }
  .tab.kind:hover { background: var(--color-hover); color: var(--color-foreground); }
  .tab.kind.active { background: var(--color-active); color: var(--color-foreground); }
  .tab.kind:active { transform: none; }
  .tab.kind .glyph { display: inline-flex; }

  /* A count while there is one: changed files, agents at work. */
  .count {
    flex: none;
    min-width: 16px;
    height: 16px;
    margin-left: 3px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--color-surface-3);
    color: var(--color-foreground);
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* While every name fits, a tab is its name and count; the front tab adds
     its icon, the close target. Compact, the tabs behind it keep their icon
     and count, their name in the tooltip and the accessible name. */
  .tabs:not(.compact) .tab.kind .glyph,
  .tabs:not(.compact) .tab:not(.active) .closer { display: none; }
  .tabs:not(.compact) .tab:not(.active) { padding: 0 7px; }
  .tabs.compact .tab:not(.active) .name { display: none; }
  .tabs.compact .tab.kind { padding: 0 6px; gap: 0; }
  .tabs.compact .tab:not(.active) .count { margin-left: 2px; }

  .tabs.measure {
    position: absolute;
    left: 0;
    top: 0;
    width: max-content;
    overflow: visible;
    visibility: hidden;
    pointer-events: none;
  }
  .measure .closer { display: inline-flex; }


  .chev {
    flex: none;
  }

  .spacer {
    flex: 1;
    min-width: 4px;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .surface {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Opacity only: a browser tab's page is a native view laid over this box,
     and a moving box would drag it along. */
  .surface:global([data-arriving]) {
    animation: fade var(--dur-3) var(--ease-out-quint);
  }

  @media (min-width: 721px) {
    .body {
      overflow: clip;
      border-radius: 0 0 calc(var(--radius-frame) - 1px) calc(var(--radius-frame) - 1px);
    }
  }

  .sheet-scrim {
    display: none;
  }

  /* Under 981 px the panel stops being a column and lies over the chat. */
  @media (max-width: 980px) {
    .panel,
    .panel.maximized {
      position: absolute;
      right: var(--frame-gap);
      top: 0;
      bottom: var(--frame-gap);
      z-index: 30;
      width: min(42vw, 448px);
      min-width: 320px;
      flex: none;
      box-shadow: var(--shadow-e3);
      /* Over the chat it takes no room: it slides across from the right edge. */
      --slide-room: calc(100% + var(--frame-gap));
      animation: slide-over-left var(--dur-slide) var(--ease-slide);
    }

    .panel.closing,
    .panel.maximized.closing {
      animation: slide-over-right-out var(--dur-slide-out) var(--ease-slide);
    }

    .sheet-scrim {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 29;
      height: auto;
      padding: 0;
      border: none;
      border-radius: 0;
      background: var(--color-scrim);
      animation: fade var(--dur-slide) var(--ease-slide);
    }

    .sheet-scrim.closing {
      animation: fade-out var(--dur-slide-out) var(--ease-slide);
      pointer-events: none;
    }
  }

  @media (max-width: 720px) {
    .strip { gap: 4px; padding: 0 4px; }

    .panel,
    .panel.maximized {
      position: fixed;
      inset: 0;
      width: auto;
      min-width: 0;
      background: var(--color-surface);
      box-shadow: var(--shadow-screen);
      /* The sheet covers the whole screen, the status bar and the home indicator included. */
      box-sizing: border-box;
      padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
      /* A screen of its own: it slides in over the conversation and back out, opaque all the way, as the conversation does over the list. */
      animation: screen-in var(--dur-3) var(--ease-slide);
    }

    .panel.closing,
    .panel.maximized.closing {
      animation: screen-out var(--dur-3) var(--ease-slide);
    }

    .sheet-scrim {
      display: none;
    }


    /* The sheet already fills the screen. */
    .maximize {
      display: none;
    }
  }

  .panel.floating {
    position: fixed;
    inset: auto;
    left: var(--float-x);
    top: var(--float-y);
    width: var(--float-width);
    height: var(--float-height);
    min-width: 0;
    flex: none;
    z-index: 34;
    background: var(--color-surface);
    box-shadow: var(--shadow-e3);
  }
  /* A floating panel appears where it was left and fades away from there. */
  .panel.floating:not(.closing) { animation: none; }
  .panel.floating.closing { animation: fade-out var(--dur-2) var(--ease-out-quint); }
  /* Once in, maximizing, docking or a narrower window changes the entrance
     rule; without this the new one would play again on the open panel. */
  .panel.entered:not(.closing) { animation: none; }
  .sheet-scrim.floating { display: none; }
  .panel.floating:not(.maximized) .strip { cursor: grab; touch-action: none; user-select: none; }
  .panel.floating:not(.maximized) .strip:active { cursor: grabbing; }
  .move-handle { cursor: grab; touch-action: none; }
  .move-handle:active { cursor: grabbing; }
  .float-resize {
    /* Outside the native webview: its OS surface would swallow inside handles. */
    position: absolute; z-index: 1; padding: 0; min-width: 0; min-height: 0;
    border: none; border-radius: 0; background: transparent; touch-action: none;
  }
  .float-resize[data-panel-resize='n'], .float-resize[data-panel-resize='s'] {
    left: 6px; right: 6px; height: 6px; width: auto; cursor: ns-resize;
  }
  .float-resize[data-panel-resize='e'], .float-resize[data-panel-resize='w'] {
    top: 6px; bottom: 6px; width: 6px; height: auto; cursor: ew-resize;
  }
  .float-resize[data-panel-resize='n'] { top: -6px; }
  .float-resize[data-panel-resize='s'] { bottom: -6px; }
  .float-resize[data-panel-resize='e'] { right: -6px; }
  .float-resize[data-panel-resize='w'] { left: -6px; }
  .float-resize[data-panel-resize='nw'], .float-resize[data-panel-resize='ne'],
  .float-resize[data-panel-resize='sw'], .float-resize[data-panel-resize='se'] { width: 12px; height: 12px; }
  .float-resize[data-panel-resize='nw'] { left: -6px; top: -6px; cursor: nwse-resize; }
  .float-resize[data-panel-resize='ne'] { right: -6px; top: -6px; cursor: nesw-resize; }
  .float-resize[data-panel-resize='sw'] { left: -6px; bottom: -6px; cursor: nesw-resize; }
  .float-resize[data-panel-resize='se'] { right: -6px; bottom: -6px; cursor: nwse-resize; }
  .float-resize:focus-visible {
    outline: 2px solid var(--color-foreground); outline-offset: 0;
  }
  .float-resize:active { transform: none; }
  .float-resize:hover:not(:disabled), .float-resize:active { background: transparent; box-shadow: none; }
  @media (max-width: 720px) {
    .move-handle, .float-resize { display: none; }
  }
</style>
