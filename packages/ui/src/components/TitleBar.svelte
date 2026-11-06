<script lang="ts">
  import { onMount } from 'svelte';
  import { PanelLeftClose, PanelLeftOpen, Settings } from '@lucide/svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import ThreadHeader from './ThreadHeader.svelte';
  import { strings } from '../lib/strings';
  import { projectName } from '../lib/format';
  import type { Store } from '../lib/store.svelte';
  import { isMac } from '../lib/keybindings';
  import { linuxShell } from '../lib/shell-platform';
  import { dragWindow, shellWindow, toggleMaximize } from '../lib/window-drag';
  import WindowResizeHandles from './WindowResizeHandles.svelte';

  /**
   * The main column's top bar, on the chrome above its panel: the sidebar's
   * fold, the open thread's title and tools, the dev tag and, in the Windows
   * shell, the caption buttons at the window's corner. On a desktop the app
   * rail and the list column stand left of it up to the window's top
   * (App.svelte sets `--bar-left`); `edge` says nothing stands there (Settings),
   * so macOS's traffic lights land on the bar itself.
   */
  let { store, edge = false }: { store: Store; edge?: boolean } = $props();

  const inShell = window.__TAURI_INTERNALS__ !== undefined;
  /** macOS draws its own traffic lights over the window's top left corner, and no caption buttons are drawn here. */
  const macShell = inShell && isMac();
  const linuxFrame = linuxShell();
  const mobile = new MediaQuery('(max-width: 720px)');
  let expanded = $derived(mobile.current ? store.sidebarOpen : !store.sidebarCollapsed);
  /**
   * The thread list and the Agents list are one column (RailFrame) and fold
   * together. On a phone the Agents list is the screen itself, with no drawer
   * to open.
   */
  let foldable = $derived(store.booted && (store.page === 'chat' || store.page === 'home' || (store.page === 'agents' && !mobile.current)));
  function toggleSidebar() {
    if (mobile.current) store.sidebarOpen = !store.sidebarOpen;
    else store.toggleSidebar();
  }

  let maximized = $state(false);

  onMount(() => {
    if (!inShell) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void shellWindow().then(async (win) => {
      maximized = await win.isMaximized();
      // onResized fires on every frame of a drag-resize. One query in flight,
      // one trailing pass for the final size, never a round-trip per event.
      let inFlight = false;
      let pending = false;
      stop = await win.onResized(async () => {
        if (inFlight) {
          pending = true;
          return;
        }
        inFlight = true;
        try {
          do {
            pending = false;
            maximized = await win.isMaximized();
          } while (pending);
        } finally {
          inFlight = false;
        }
      });
      if (disposed) stop();
    });
    return () => {
      disposed = true;
      stop?.();
    };
  });

  async function minimize() {
    await (await shellWindow()).minimize();
  }

  /** The shell quits by default, or hides when its close-to-tray setting is on. */
  async function close() {
    await (await shellWindow()).close();
  }

  /**
   * What the bar reads when no thread header takes its place. Never the app's
   * own name: the window title and the taskbar carry it, and in the bar it only
   * took room from the project or the thread.
   */
  let heading = $derived(store.page === 'settings' ? strings.settings.heading : store.openProject ? projectName(store.openProject) : '');
  let threadHeader = $derived(store.page === 'chat' && (store.openThread || store.draft));
  /** The dev install runs beside the stable one, so the bar has to say which is open. */
  let dev = $derived(store.core?.channel === 'dev');

</script>

<WindowResizeHandles />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header class="titlebar" class:browser={!inShell} class:mac={macShell} class:edge class:linux={linuxFrame} onmousedown={dragWindow} data-testid="titlebar">
  {#if foldable}
    <button type="button" class="ghost icon sidebar-toggle"
      aria-label={expanded ? strings.sidebar.collapse : strings.sidebar.expand}
      title={`${expanded ? strings.sidebar.collapse : strings.sidebar.expand}${store.keyHint('sidebar')}`}
      aria-expanded={expanded} data-testid="sidebar-toggle" onclick={toggleSidebar}>
      {#if expanded}<PanelLeftClose size={17} strokeWidth={1.75} />{:else}<PanelLeftOpen size={17} strokeWidth={1.75} />{/if}
    </button>
  {/if}
  {#if threadHeader && (inShell || !mobile.current)}
    {#key store}<ThreadHeader {store} />{/key}
  {:else}
    <span class="name ui-label">{store.page === 'agents' ? strings.agents.heading : store.page === 'home' ? strings.contacts.heading : heading}</span>
  {/if}
  {#if inShell && store.booted && store.page !== 'settings'}
    <!-- A shell window narrower than a phone has no app rail: Settings stays one press away here. -->
    <button type="button" class="ghost icon narrow-settings" title={strings.sidebar.settings} aria-label={strings.sidebar.settings}
      data-testid="titlebar-settings" onclick={() => store.showSettings()}><Settings size={17} strokeWidth={1.75} /></button>
  {/if}
  {#if dev}
    <span class="channel ui-label-box" title={strings.app.channelDevTitle} data-testid="titlebar-channel"><span class="ui-label">{strings.app.channelDev}</span></span>
  {/if}
  {#if inShell && !macShell && !linuxFrame}
  <!-- Windows' caption buttons: 46 px wide, the bar's full height, no gap and
       flush with the edge, so a throw into the top right corner lands on Close. -->
  <div class="controls" data-testid="titlebar-controls">
    <button type="button" class="ctl" aria-label={strings.titlebar.minimize} title={strings.titlebar.minimize} onclick={() => void minimize()}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
    </button>
    <button
      type="button"
      class="ctl"
      aria-label={maximized ? strings.titlebar.restore : strings.titlebar.maximize}
      title={maximized ? strings.titlebar.restore : strings.titlebar.maximize}
      data-testid="titlebar-maximize"
      data-maximized={maximized}
      onclick={() => void toggleMaximize()}
    >
      {#if maximized}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5v-2h7v7h-2" /><rect x="0.5" y="2.5" width="7" height="7" /></svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
      {/if}
    </button>
    <button type="button" class="ctl close" aria-label={strings.common.close} title={strings.common.close} data-testid="titlebar-close" onclick={() => void close()}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m0.5 0.5 9 9m0-9-9 9" /></svg>
    </button>
  </div>
  {/if}
</header>

<style>
  .titlebar {
    display: flex;
    gap: 8px;
    padding-left: 6px;
    align-items: center;
    height: var(--titlebar);
    min-width: 0;
    /* It stands on the app's chrome: no ground and no line of its own. */
    background: transparent;
    user-select: none;
    -webkit-user-select: none;
    flex: none;
    cursor: default;
  }

  /* In the shell the caption buttons end the bar at its edge. */
  .titlebar.browser, .titlebar.linux { padding-right: 4px; }
  .titlebar.mac { padding-right: 8px; }
  .sidebar-toggle { flex: none; }
  .narrow-settings { flex: none; display: none; margin-left: auto; }
  @media (min-width: 721px) {
    /* Right of the app rail and the list column, which reach the window's top. */
    .titlebar { margin-left: var(--bar-left, 0px); }
    /* macOS: the traffic lights, 16 px in and about 52 px wide, then the usual gap, where nothing stands left of the bar. */
    .titlebar.mac.edge { padding-left: 80px; }
  }
  @media (max-width: 720px) {
    .titlebar.mac { padding-left: 80px; }
    .narrow-settings { display: inline-flex; }
  }
  @media (max-width: 720px) {
    .titlebar { background: var(--color-frame); border-bottom: 1px solid var(--color-border); }
    .titlebar.browser { background: var(--color-background); padding: 0 16px; }
    .browser .sidebar-toggle { display: none; }
  }
  .name { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  /* Alone in the bar, the label starts where the toggle's icon would: 16 px in. */
  .name:first-child { padding-left: 8px; }
  /* The phone bar already pads 16 px. */
  @media (max-width: 720px) {
    .titlebar.browser .name:first-child { padding-left: 0; }
  }

  .channel {
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
  }

  .controls {
    display: flex;
    flex: none;
    align-self: stretch;
    margin-left: 4px;
  }

  .ctl {
    width: var(--caption);
    height: 100%;
    padding: 0;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--color-muted-foreground);
  }

  .ctl svg { fill: none; stroke: currentColor; stroke-width: 1; }

  .ctl:hover:not(:disabled),
  .ctl:focus-visible {
    background: var(--color-hover);
    color: var(--color-foreground);
    outline: none;
  }

  /* A window control is part of the frame: it darkens under the finger rather
     than moving, because the frame itself never moves. */
  .ctl:active:not(:disabled) {
    transform: none;
    background: var(--color-active);
  }

  .ctl.close:hover:not(:disabled),
  .ctl.close:focus-visible {
    background: var(--color-caption-close);
    color: var(--color-on-danger);
  }

  .ctl.close:active:not(:disabled) {
    background: color-mix(in srgb, var(--color-caption-close) 85%, var(--color-foreground));
  }
</style>
