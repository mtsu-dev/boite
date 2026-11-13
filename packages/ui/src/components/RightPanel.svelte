<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { ArrowLeft, ArrowRightToLine, ChevronLeft, ChevronRight, ListX, Maximize2, Minimize2, SquareX, X, GripHorizontal, PanelsTopLeft } from '@lucide/svelte';
  import { floatingPanel, RESIZE_DIRECTIONS } from '../lib/floating-panel';
  import { browserBridge } from '../lib/browser-bridge';
  import { stripOverflows } from '../lib/strip-overflow';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { longPress } from '../lib/long-press';
  import { controlMenu, CONTROLS_SECTION } from '../lib/controls';
  import type { ControlId } from '../lib/work-prefs.svelte';
  import { separator, type MenuItem } from '../lib/menu';
  import { closeTabs } from '../lib/panel-close';
  import { innerWidth } from 'svelte/reactivity/window';
  import { clampPanel, panelOverChat, panelSibling, rightPanel } from '../lib/right-panel.svelte';
  import type { BoundPanel, Surface, SurfaceKind } from '../lib/right-panel.svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { offeredCards, available as availableTo, label, tooltip } from '../lib/surface-labels';
  import { CUSTOMIZE, notePanelUse, panelChoices, panelPlace, usedPanels } from '../lib/panel-choices';
  import { panelSwitch } from '../lib/panel-switch.svelte';
  import { surfaceGlyph } from '../lib/surface-glyphs';
  import { openCoordination } from '../lib/coordination-request.svelte';
  import { arriveSurface } from '../lib/surface-swap';
  import { providePanelTools } from '../lib/panel-tools.svelte';
  import BrowserSurface from './BrowserSurface.svelte';
  import AgentBrowserSurface from './AgentBrowserSurface.svelte';
  import DelegationSurface from './DelegationSurface.svelte';
  import AgentMessagesSurface from './AgentMessagesSurface.svelte';
  import ChangesSurface from './ChangesSurface.svelte';
  import DeviceSurface from './DeviceSurface.svelte';
  import WindowSurface from './WindowSurface.svelte';
  import FileSurface from './FileSurface.svelte';
  import FilesSurface from './FilesSurface.svelte';
  import PanelDoor from './PanelDoor.svelte';
  import PanelSwitcher from './PanelSwitcher.svelte';
  import PanelResizeHandle from './PanelResizeHandle.svelte';
  import SurfaceIcon from './SurfaceIcon.svelte';
  import SurfaceLauncher from './SurfaceLauncher.svelte';
  import TasksSurface from './TasksSurface.svelte';
  import TraceSurface from './TraceSurface.svelte';
  import AgentDesk from './agents/AgentDesk.svelte';
  import { loadCouncilSalon } from '../lib/council-entry';
  import PluginTabSurface from './PluginTabSurface.svelte';
  import { pluginUi } from '../lib/plugin-ui.svelte';
  import { workspace } from '../lib/workspace.svelte';

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

  const inShell = window.__TAURI_INTERNALS__ !== undefined;
  /** The showing surface's way back, which a phone's head arrow takes first (`lib/panel-tools.svelte.ts`). */
  const tools = providePanelTools();
  const phone = $derived((innerWidth.current ?? window.innerWidth) <= 720);
  /**
   * The docked width: the one asked for, within the room the chat keeps once
   * the thread list and the contacts column take theirs. The asked width stays
   * stored for when the room comes back.
   */
  const docked = $derived(clampPanel(rightPanel.width, innerWidth.current ?? window.innerWidth, panelSibling(store, innerWidth.current ?? window.innerWidth)));
  /** Too little room for the chat beside the list and a column: the panel lies over the chat instead. */
  const over = $derived(panelOverChat(innerWidth.current ?? window.innerWidth, panelSibling(store, innerWidth.current ?? window.innerWidth)));

  let tabs = $state<HTMLDivElement | undefined>(undefined);
  let root = $state<HTMLElement | undefined>(undefined);
  let overflowing = $state(false);
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
   * A surface a tab switch brings: there in the frame the old one leaves,
   * one fade from a high opacity and a few pixels from the side of its place
   * in the launcher (`lib/surface-swap.ts`). Only once the panel is in, so the
   * panel landing plays no second entrance. The strip above stays still.
   */
  let shownKind: string | null = null;
  function arriveAfter(node: HTMLElement): void {
    const kind = untrack(() => active?.kind) ?? null, before = shownKind;
    shownKind = kind;
    if (!untrack(() => entered)) return;
    // A browser's native view would not follow a transform: it only fades.
    const still = !kind || !before || kind === 'browser' || kind === 'agent-browser';
    arriveSurface(node, undefined, still ? 0 : panelPlace(kind) - panelPlace(before));
  }

  /** What a phone's head keeps beside the panel's door: the thread, or the bot whose desk this is. */
  let threadTitle = $derived(store.openThread?.title ?? null);
  let surfaces = $derived(panel.surfaces);
  let active = $derived(panel.active);
  let CouncilSalon = $state.raw<typeof import('./council/CouncilSalon.svelte').default>(), loadingSalon: Promise<void> | undefined; // fetched with the first council tab (lib/council-entry.ts)
  $effect(() => { if (active?.kind === 'council' && !CouncilSalon) loadingSalon ??= loadCouncilSalon()?.then(module => { CouncilSalon = module.default; }).catch(() => { loadingSalon = undefined; }); });
  let empty = $derived(surfaces.length === 0);
  /** A bot's desk alone keeps the side card's form, at a column's width. */
  let deskOnly = $derived(!phone && !rightPanel.floating && surfaces.length === 1 && surfaces[0]!.kind === 'desk');
  /** A bot's desk alone stays a side column at any panel width: the chat beside it is the page. */
  const DESK_MAX = 380;

  /** The user's own browser needs the shell's webview, or the iframe a test page paints. */
  function available(kind: SurfaceKind): boolean {
    if (kind === 'browser' && !inShell) return browserBridge.paints;
    return availableTo(kind, inShell, store.owner);
  }

  function measure(): void {
    const node = tabs;
    // A strip with no width yet, a phone's sheet still coming in, has nothing to
    // measure: the observer calls again once it has one. Measured at zero, 44 px
    // chevrons wider than the tabs flipped the state on every run.
    if (!node || node.clientWidth === 0) return;
    const gap = parseFloat(getComputedStyle(node.parentElement ?? node).columnGap) || 0;
    const room = [...(node.parentElement?.querySelectorAll<HTMLElement>(':scope > .chev') ?? [])].reduce((sum, chevron) => sum + chevron.offsetWidth + gap, 0);
    overflowing = stripOverflows(node.scrollWidth, node.clientWidth, room, untrack(() => overflowing));
    readEdges();
  }

  /** Which ends of the strip hide a tab: that end fades instead of cutting a label in half, and its chevron rests. */
  let hiddenStart = $state(false);
  let hiddenEnd = $state(false);
  function readEdges(): void {
    const node = tabs;
    if (!node) return;
    hiddenStart = node.scrollLeft > 1;
    hiddenEnd = node.scrollLeft < node.scrollWidth - node.clientWidth - 1;
  }

  $effect(() => {
    const node = tabs;
    if (!node) return;
    // The strip is remeasured when its width or its content changes.
    void surfaces.length;
    untrack(measure);
    // jsdom lays nothing out and ships no ResizeObserver: the strip still renders.
    if (typeof ResizeObserver === 'undefined') return;
    // The chevrons resize the observed tabs: toggling them inside the callback
    // was a resize the observer could not deliver that frame (a loop error).
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });

  // The tab that is showing is always the one in view, also once the chevrons
  // that an overflow brings have narrowed the strip under it.
  $effect(() => {
    const id = panel.activeSurfaceId;
    void overflowing;
    if (!id || !tabs) return;
    const tab = tabs.querySelector<HTMLElement>(`[data-surface-id="${CSS.escape(id)}"]`);
    // jsdom has no layout, so it has no `scrollIntoView` either.
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });

  /** The X shuts the panel and hands the keys to the header's door that opens it again; clicked, it left them on the page. */
  function shut(): void {
    // A phone's one back arrow steps back inside the surface first (a file to its list), then leaves the panel.
    if (phone && tools.back) { tools.back.run(); return; }
    panel.hide();
    // The door turns back from the switcher into the "Panels" button once the panel is gone.
    if (!phone) void tick().then(() => document.querySelector<HTMLElement>('[data-testid="panel-toggle"]')?.focus({ preventScroll: true }));
  }

  function scrollBy(direction: -1 | 1): void {
    const node = tabs;
    if (!node) return;
    const step = Math.max(120, Math.round(node.clientWidth * 0.75));
    node.scrollBy({ left: step * direction, behavior: 'smooth' });
  }

  function onwheel(event: WheelEvent): void {
    const node = tabs;
    if (!node || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    node.scrollLeft += event.deltaY;
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
    // The tab's own key only: Enter on its close button does what that control says.
    if (event.target !== event.currentTarget) return;
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


  const PLUGIN_TAB = 'plugin-tab:';
  /** Plugin interfaces load from the window's own core, so their tabs are offered on its threads. */
  const pluginTabsHere = $derived(store === workspace.primary);

  /** The panels this thread used live outside the runes: a use noted makes the list again. */
  let noted = $state(0);
  /** The launcher's list, every panel at once: the ones this thread used on top, then every panel by group (`lib/panel-choices.ts`). */
  let choices = $derived.by(() => {
    void noted;
    const thread = store.openThread?.id ?? null;
    // The tabs plugin interfaces add, on the machine that loaded them.
    const plugins = pluginTabsHere ? pluginUi.tabs.map((tab) => ({ id: `${PLUGIN_TAB}${tab.key}`, label: tab.title, glyph: surfaceGlyph('plugin') })) : [];
    return panelChoices(store, store.openThread, { phone, available, showing: active?.kind, used: usedPanels(store, thread, active?.kind), plugins });
  });
  function note(kind: string): void {
    const thread = store.openThread?.id;
    if (!thread) return;
    notePanelUse(store, thread, kind);
    noted++;
  }
  /** A phone's tab has no glyph to close it by: its switcher's last row closes the showing panel. */
  const CLOSE_TAB = 'close-tab';
  /**
   * The launcher's list: every panel. A desktop's strip keeps its own
   * buttons for the window (dock, maximize) and the close beside the "+";
   * a phone's door ends on closing the showing panel.
   */
  let headChoices = $derived<MenuItem[]>([
    ...choices,
    ...(phone && active ? [separator('sep-close'), { id: CLOSE_TAB, label: fill(strings.rightPanel.closeTab, { title: label(active) }), glyph: X }] : [])
  ]);

  // The switcher (the strip's "+", the phone's door) lists the panels and names the showing one: the panel tells it what to say while it is here.
  $effect(() => {
    panelSwitch.store = store;
    panelSwitch.name = active ? label(active) : strings.thread.panelMenu;
    panelSwitch.title = active ? tooltip(active) : '';
    panelSwitch.glyph = active ? surfaceGlyph(active.kind) : null;
    panelSwitch.items = () => headChoices;
    panelSwitch.pick = pickPanel;
    panelSwitch.door = PanelSwitcher;
    return () => { if (panelSwitch.store === store) panelSwitch.store = null; };
  });

  // The panel showing is the one this thread used last: the launcher lists it first.
  $effect(() => {
    const kind = active?.kind;
    if (kind && store.openThread) untrack(() => note(kind));
  });

  function pickPanel(id: string): void {
    const thread = store.openThread;
    if (id === 'terminal-toggle' || id === 'board-toggle' || id === 'coordination') note(id);
    if (id === CLOSE_TAB) { if (active) void closeTabs(panel, 'close', active.id); }
    else if (id === CUSTOMIZE) store.showSettings('appearance', CONTROLS_SECTION);
    else if (id.startsWith(PLUGIN_TAB)) { const tab = pluginUi.tab(id.slice(PLUGIN_TAB.length)); if (tab) panel.openPluginTab(tab.key, tab.title); }
    else if (id === 'terminal-toggle') store.toggleTerminal();
    else if (id === 'board-toggle' || id === 'coordination') {
      // A phone's sheet covers the chat the board and the dialog belong to.
      if (phone) panel.hide();
      if (id === 'board-toggle') store.toggleBoard();
      else if (thread) openCoordination(store, thread.id);
    } else {
      // A kind already open is gone back to, not opened twice.
      const open = surfaces.find((surface) => surface.kind === id);
      if (open) panel.activate(open.id);
      else launch(id as SurfaceKind);
    }
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<button
  type="button"
  class="sheet-scrim"
  class:over
  class:floating={rightPanel.floating}
  class:closing
  aria-label={strings.common.close}
  onclick={() => panel.toggle()}
></button>

<aside
  class="panel framed"
  class:over
  class:maximized={rightPanel.maximized}
  class:floating={rightPanel.floating}
  class:dragging
  class:closing
  class:entered
  style="--panel-width: {deskOnly ? Math.min(docked, DESK_MAX) : docked}px"
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
  {#if !rightPanel.floating && !over}<PanelResizeHandle {store} bind:dragging />{/if}

  <header class="strip" data-panel-move data-testid="panel-titlebar">
    {#if rightPanel.floating}
      <button type="button" class="ghost small icon move-handle" data-panel-move data-testid="panel-move"
        title={strings.browser.move} aria-label={strings.browser.move} disabled={rightPanel.maximized}>
        <GripHorizontal size={16} />
      </button>
    {/if}
    {#if overflowing}
      <button
        type="button"
        class="ghost small icon chev"
        title={strings.rightPanel.scrollLeft}
        aria-label={strings.rightPanel.scrollLeft}
        disabled={!hiddenStart}
        onclick={() => scrollBy(-1)}
      >
        <ChevronLeft size={14} strokeWidth={1.75} />
      </button>
    {/if}

    <div
      class="tabs"
      class:hidden-start={overflowing && hiddenStart}
      class:hidden-end={overflowing && hiddenEnd}
      role="tablist"
      tabindex="-1"
      bind:this={tabs}
      {onwheel}
      onscroll={readEdges}
      onkeydown={onTabsKey}
      data-testid="panel-tabs"
    >
      {#each surfaces as surface (surface.id)}
        <div
          class="tab"
          class:active={surface.id === panel.activeSurfaceId}
          role="tab"
          tabindex="0"
          aria-selected={surface.id === panel.activeSurfaceId}
          data-surface-id={surface.id}
          data-kind={surface.kind}
          data-testid="panel-tab"
          title={tooltip(surface)}
          onclick={() => panel.activate(surface.id)}
          onkeydown={(event) => onTabKey(event, surface)}
          onmousedown={(event) => onTabPointerDown(event, surface)}
          oncontextmenu={(event) => openTabMenu(event, surface)}
          use:longPress
        >
          <!-- Every open panel is its glyph alone, named in its tooltip (a phone's door names it too).
               The showing one is filled. Its close is a corner cross under the pointer. -->
          <span class="glyph solo" aria-hidden="true"><SurfaceIcon kind={surface.kind} size={14} /></span>
          <span class="name ui-label sr-only">{label(surface)}</span>
          <button
            type="button"
            class="corner"
            aria-label={fill(strings.rightPanel.closeTab, { title: label(surface) })}
            data-testid="panel-tab-close"
            onclick={(event) => {
              event.stopPropagation();
              void closeTabs(panel, 'close', surface.id);
            }}
          ><X size={10} strokeWidth={2.5} /></button>
        </div>
      {/each}
    </div>

    {#if overflowing}
      <button
        type="button"
        class="ghost small icon chev"
        title={strings.rightPanel.scrollRight}
        aria-label={strings.rightPanel.scrollRight}
        disabled={!hiddenEnd}
        onclick={() => scrollBy(1)}
      >
        <ChevronRight size={14} strokeWidth={1.75} />
      </button>
    {/if}

    <!-- A desktop's "+" after the tabs opens the launcher (PanelSwitcher.svelte): every panel, searchable. -->
    {#if !phone}<PanelSwitcher add />{/if}

    <!-- The showing surface's head goes here (SurfaceHead.svelte): one head, named on its tab. A phone's strip holds the thread and the door. -->
    {#if phone}<span class="spacer"></span>{:else}<div class="surface-head" data-testid="panel-surface-head" bind:this={tools.slot}></div>{/if}

    {#if !phone}
      {#if rightPanel.floating}<button type="button" class="ghost small icon" data-testid="panel-dock" title={strings.browser.dock} aria-label={strings.browser.dock}
        onclick={() => { rightPanel.floating = false; rightPanel.maximized = false; }}><PanelsTopLeft size={14} strokeWidth={1.75} /></button>{/if}
      {@const sizeLabel = rightPanel.maximized ? strings.rightPanel.restore : strings.rightPanel.maximize}
      <button type="button" class="ghost small icon maximize" data-testid="panel-maximize" title={sizeLabel} aria-label={sizeLabel} aria-pressed={rightPanel.maximized}
        onclick={() => (rightPanel.maximized = !rightPanel.maximized)}>{#if rightPanel.maximized}<Minimize2 size={14} strokeWidth={1.75} />{:else}<Maximize2 size={14} strokeWidth={1.75} />{/if}</button>
    {/if}

    {#if phone}
      <!-- A phone's panel covers the thread: its title stays on top, and the door beside it names the panel and switches it. -->
      {#if threadTitle}<span class="thread-line ui-label" data-testid="panel-thread-title">{threadTitle}</span>{/if}
      <PanelDoor {store} testid="panel-toggle" inPanel />
    {/if}

    <button
      type="button"
      class="icon-button panel-close"
      title={phone ? (tools.back?.label ?? strings.rightPanel.backToChat) : strings.common.close}
      aria-label={phone ? (tools.back?.label ?? strings.rightPanel.backToChat) : strings.common.close}
      data-testid="panel-close"
      onclick={shut}
    >
      {#if phone}
        <ArrowLeft size={20} strokeWidth={1.75} />
      {:else}
        <X size={14} strokeWidth={1.75} />
      {/if}
    </button>
  </header>

  <div class="body">
    <!-- Keyed on the tab: the old surface leaves at once and the new one is
         there in the same frame, settling in. -->
    {#key active?.id}
    <div class="surface" use:arriveAfter>
    {#if active?.kind === 'desk'}
      {#if store.openThread?.agentSessionId}
        {#key store.threadKey(store.openThread.id)}<AgentDesk {store} />{/key}
      {/if}
    {:else if active?.kind === 'agents'}
      <DelegationSurface {store} surface={active} {panel} />
    {:else if active?.kind === 'messages'}
      <AgentMessagesSurface {store} surface={active} {panel} />
    {:else if active?.kind === 'trace'}
      <TraceSurface {store} />
    {:else if active?.kind === 'browser'}
      {#key active.id}<BrowserSurface surface={active} {panel} {store} />{/key}
    {:else if active?.kind === 'agent-browser'}
      {#if store.openThread}
        {#key store.threadKey(store.openThread.id)}<AgentBrowserSurface {store} threadId={store.openThread.id} />{/key}
      {/if}
    {:else if active?.kind === 'changes'}
      <ChangesSurface {store} surface={active} {panel} />
    {:else if active?.kind === 'files'}
      <FilesSurface {store} surface={active} {panel} />
    {:else if active?.kind === 'file'}
      <!-- One editor per document: the same path open in another thread is another file's tab. -->
      {#key `${panel.threadId}\n${active.id}`}
        <FileSurface {store} surface={active} {panel} />
      {/key}
    {:else if active?.kind === 'device'}
      {#if store.openThread}
        {#key store.threadKey(store.openThread.id)}<DeviceSurface {store} threadId={store.openThread.id} />{/key}
      {/if}
    {:else if active?.kind === 'window'}
      {#if store.openThread}
        {#key store.threadKey(store.openThread.id)}<WindowSurface {store} threadId={store.openThread.id} />{/key}
      {/if}
    {:else if active?.kind === 'tasks'}
      <TasksSurface {store} />
    {:else if active?.kind === 'council' && active.councilId && CouncilSalon}
      <!-- One salon per debate: the tab moved to another debate starts its reading afresh. -->
      {#key active.councilId}<CouncilSalon {store} councilId={active.councilId} threadId={panel.threadId ?? undefined} />{/key}
    {:else if active?.kind === 'plugin' && active.tab}
      {#key active.tab}<PluginTabSurface tab={active.tab} threadId={pluginTabsHere ? (store.openThread?.id ?? null) : null} />{/key}
    {:else}
      <SurfaceLauncher
        {available}
        onlaunch={launch}
        onmenu={(event, kind) => controlMenu(event, store, `panel.${kind}` as ControlId)}
        oncustomize={() => store.showSettings('appearance', CONTROLS_SECTION)}
      />
    {/if}
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
    animation: slide-left var(--motion-duration) var(--motion-curve);
  }

  .panel.closing {
    animation: slide-right-out var(--motion-duration) var(--motion-curve);
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
  }

  /* The strip's controls are as tall as its tabs: a target of 28 px at least. */
  .strip button.small.icon {
    height: var(--control);
    width: var(--control);
  }
  /* The close and the head's refresh are app.css's icon button, their box as large as their 32 px target. */
  .panel-close, .surface-head :global(button.icon-button) { flex: none; margin: calc((var(--icon-button-target) - var(--icon-button)) / 2); }
  /* The tabs scroll, so they clip: a keyboard ring drawn outside a tab or its close would be cut, it goes inside. */
  .tabs :global(:focus-visible) { outline-offset: -2px; }

  /* Only the tabs give way. A control that shrank too took part of the room the
     chevrons cost, so the tabs lost less than `measure` counted and the
     chevrons went and came back on every frame at the panel's narrowest. */
  .surface-head { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; padding-left: 8px; overflow: hidden; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  /* Its actions are the strip's targets: 32 px, each named by its tooltip. */
  .surface-head :global(button.small.icon) { width: var(--control-head); height: var(--control-head); }
  .strip > :not(.tabs, .spacer, .thread-line, .surface-head) {
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

  /* An open panel: a square as tall as the strip's targets, its glyph centred. */
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--control);
    height: var(--control);
    flex: none;
    padding: 0;
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
    cursor: pointer;
    user-select: none;
    /* No transition: the strip stays still while the body changes under it, the picked tab lit in the same frame. */
  }

  .tab:hover {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  .tab.active {
    background: var(--color-active);
    color: var(--color-foreground);
  }

  .solo { display: inline-flex; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  /* Its close, a small cross on its corner, under the pointer or a focused tab only; hidden, a tap there picks the tab. */
  .corner {
    position: absolute;
    /* Inside the square: the strip clips what leaves it. */
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    color: var(--color-foreground);
    opacity: 0;
    visibility: hidden; pointer-events: none;
  }
  .tab:hover .corner, .tab:focus-within .corner { opacity: 1; visibility: visible; pointer-events: auto; }
  .corner:hover:not(:disabled) { background: var(--color-surface-2); }

  .chev {
    flex: none;
  }

  .spacer {
    flex: 1;
    min-width: 4px;
  }

  /* The bot's info alone: the strip leaves the flow without its tabs; add,
     expand and close show under the pointer, or always without one. */

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

  /* A panel switch changes the body only: it fades in and slides a few pixels
     from its side while the strip stays still, so the eye keeps its place. The
     old body has left in the same frame (keyed), so no frame holds two. Filled
     backwards only: a transform left on after the end would hold the surface's
     fixed children. */
  .surface:global([data-arriving]) {
    animation: surface-fade var(--motion-duration) var(--motion-curve) backwards;
  }
  @keyframes surface-fade { from { opacity: 0.4; transform: translateX(var(--arrive-x, 0px)); } }
  /* A cut under reduced motion, whatever the duration tokens say. */
  @media (prefers-reduced-motion: reduce) { .surface:global([data-arriving]) { animation: none; } }
  :global(html[data-motion='reduced']) .surface:global([data-arriving]) { animation: none; }

  @media (min-width: 721px) {
    .body {
      overflow: clip;
      border-radius: 0 0 calc(var(--radius-frame) - 1px) calc(var(--radius-frame) - 1px);
    }
  }

  .sheet-scrim {
    display: none;
  }

  /* Too little room (`panelOverChat`): the panel lies over the chat; `:where` lets the phone rules win. */
  .panel:where(.over),
  .panel.maximized:where(.over) {
    position: absolute;
    right: var(--frame-gap);
    top: 0;
    bottom: var(--frame-gap);
    z-index: 30;
    width: min(42vw, 448px);
    min-width: 320px;
    flex: none;
    box-shadow: var(--shadow-overlay);
    /* Over the chat it takes no room: it slides across from the right edge. */
    --slide-room: calc(100% + var(--frame-gap));
    animation: slide-over-left var(--motion-duration) var(--motion-curve);
  }

  .panel.closing:where(.over),
  .panel.maximized.closing:where(.over) {
    animation: slide-over-right-out var(--motion-duration) var(--motion-curve);
  }

  .sheet-scrim:where(.over) {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 29;
    height: auto;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--color-scrim);
    animation: fade var(--motion-duration) var(--motion-curve);
  }

  .sheet-scrim.closing:where(.over) {
    animation: fade-out var(--motion-duration) var(--motion-curve);
    pointer-events: none;
  }

  @media (max-width: 720px) {
    /* One back arrow, the thread's title, then the door that names the panel and switches it. */
    .panel-close { order: -1; margin-left: -2px; }
    .tabs, .chev, .spacer { display: none; }
    .strip { gap: 6px; }
    .strip :global(.panel-door) { margin-left: auto; }
    /* Two lines at most, as every phone title. */
    .thread-line { flex: 1; min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; font-size: var(--text-base); font-weight: 600; line-height: 1.2; color: var(--color-foreground); margin-block: 0; padding-block: 0; text-box: normal; }

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
      animation: screen-in var(--dur-3) var(--motion-curve);
    }

    .panel.closing,
    .panel.maximized.closing {
      animation: screen-out var(--dur-3) var(--motion-curve);
    }

    .sheet-scrim {
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
    box-shadow: var(--shadow-overlay);
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
    outline: var(--focus-ring); outline-offset: 0;
  }
  .float-resize:active { transform: none; }
  .float-resize:hover:not(:disabled), .float-resize:active { background: transparent; box-shadow: none; }
  @media (max-width: 720px) {
    .move-handle, .float-resize { display: none; }
  }
</style>
