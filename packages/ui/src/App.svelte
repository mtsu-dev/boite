<script lang="ts">
  import { desktopShell, MOBILE_BUILD } from './lib/shell-platform';
  import { errorText } from './lib/errors';
  import { onMount, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { opensFromLink, readStoredEndpoint, shellStarting, takeNotificationTarget } from './lib/endpoint';
  import { watchAgentBrowser } from './lib/agent-browser-watch';
  import { watchDevices } from './lib/device-watch';
  import { watchWindows } from './lib/window-watch';
  import { browserProfiles } from './lib/browser-profiles.svelte';
  import UndoToast from './components/UndoToast.svelte';
  import { closeThreadExport, threadExport } from './lib/thread-export-request.svelte';
  import ErrorToast from './components/ErrorToast.svelte';
  import Notice from './components/Notice.svelte';
  import { CircleAlert } from '@lucide/svelte';
  import { toastSlot } from './lib/notify-corner';
  import Deferred from './components/Deferred.svelte';
  import { inbox } from './lib/inbox.svelte';
  import { activityPage } from './lib/activity-page';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import MoveProjectPicker from './components/MoveProjectPicker.svelte';
  import DragGhost from './components/DragGhost.svelte';
  import DropOverlay from './components/DropOverlay.svelte';

  import TitleBar from './components/TitleBar.svelte';
  import AppRail from './components/AppRail.svelte';
  import { Closing } from './lib/closing.svelte';
  import { focusComposer } from './lib/focus';
  import { handleAppKey } from './lib/app-keys';
  import { confirm } from './lib/confirm.svelte';
  import { startGlass } from './lib/glass';
  import { installExternalLinks } from './lib/links';
  import { installDropNavigationGuard } from './lib/drop-navigation';
  import QuitHint from './components/QuitHint.svelte';
  import { closingStores, confirmedQuitHold, desktopQuit, installQuitGuard } from './lib/shell-quit';
  import { notificationWords, onNotificationOpen, storeNotificationWords, storeWorkerLocale } from './lib/notify';
  import { strings } from './lib/strings';
  import { activeLocale } from './lib/i18n.svelte';
  import { retryOrReload } from './lib/retry-load';
  import { warmOfflineConversations } from './lib/sw';
  import { experimentOn } from './lib/experiments.svelte';
  import { featureOn } from './lib/features.svelte';
  import { contactsShown, contactsViews } from './lib/contacts-views.svelte';
  import { whipEntry } from './lib/whip-entry.svelte';
  import { rightPanel } from './lib/right-panel.svelte';
  import type { Page } from './lib/store.svelte';
  import { workspace } from './lib/workspace.svelte';
  import { listAbsent } from './lib/list-absent';
  import { visibleSidebarWidth } from './lib/prefs';
  import { hostLocalAgentBrowser } from './lib/agent-browser-host.svelte';
  import { tourRequested, tourSeen } from './lib/onboarding.svelte';
  import { needsAnAI } from './lib/first-run';
  import { whenIdle } from './lib/idle';
  import { prefetchAllowed, prefetchNames, warmPages } from './lib/prefetch';
  import { parts, prefetchParts } from './lib/deferred-parts';
  import { LazyComponent } from './lib/lazy-component.svelte';
  import { mobileNavigation } from './lib/mobile-navigation';
  import { voice } from './lib/voice-prefs.svelte';
  import { startTheme } from './lib/theme';
  import { appName, appUpdater } from './lib/app-update.svelte';
  import { reportDesktopUpdates } from './lib/desktop-update.svelte';
  import { watchUpdates } from './lib/update-watch';
  import MobileConnect from './components/MobileConnect.svelte';
  import MobilePairing from './components/MobilePairing.svelte';
  import { attentionCount, syncAppBadge } from './lib/badge';
  import { startViewport } from './lib/viewport';
  import { watchRest } from './lib/at-rest';
  import { watchLoopPhase } from './lib/loop-phase';
  import { WsClient } from './lib/client';
  import { watchAbsence, watchWake } from './lib/ws-client-utils';
  import { listenForInstall } from './lib/pwa';
  import { appPage } from './lib/app-origin';
  import { localNetwork } from './lib/local-network.svelte';
  import { mobileOverlay } from './lib/mobile-history';
  import { startViewHistory } from './lib/view-history.svelte';
  import { agentAutoLink } from './lib/agent-links.svelte';
  import ThreadPreparation from './components/ThreadPreparation.svelte';

  let store = $derived(workspace.active);
  const inShell = desktopShell();
  // The phone's navigation (`lib/mobile-navigation.ts`). A failed fetch (offline,
  // cold cache) lets the app draw with a bar that says so and retries, by hand,
  // when the core answers again or when the browser is back online.
  function loadMobileNavigation(): void {
    if (!inShell) void mobileNavigation.load().catch(() => undefined);
  }
  // The microphone sits in the composer's first frame: its chunk starts with the app too.
  if (voice.current.enabled) void parts.Dictation.load().catch(() => undefined);
  // The id alone: the full conversation replacing the row a click drew must not start the watchers again.
  const watchedThreadId = $derived(store.openThread?.id);
  // New agent pages bring the panel forward on wider clients; phones stay on the user's chosen view.
  $effect(() => {
    const threadId = watchedThreadId;
    void store.connection;
    if (threadId && store.client?.state === 'ready') return watchAgentBrowser(store, threadId);
  });
  // A simulator or emulator the agent opens shows up in the panel, here and on a phone (docs/internals/devices.md); so does a desktop window it watches.
  $effect(() => {
    const threadId = watchedThreadId;
    void store.connection;
    const stops = threadId && store.client?.state === 'ready' ? [watchDevices(store, threadId), watchWindows(store, threadId)] : [];
    return () => stops.forEach((stop) => stop());
  });
  const narrow = new MediaQuery('(max-width: 720px)');
  const desktopStartup = !MOBILE_BUILD && (inShell || !narrow.current);
  const sidebar = new LazyComponent(() => import('./components/Sidebar.svelte'));
  const chatView = new LazyComponent(() => import('./components/ChatView.svelte'));
  const agentsLayout = new LazyComponent(() => import('./components/agents/AgentsLayout.svelte'));
  let desktopViewsSettled = $state(!desktopStartup);
  let appRoot = $state<HTMLDivElement | undefined>(undefined);
  let mobileScreen = $state<'chat' | 'threads' | 'activity'>('chat'), mobileTabs = $state(false);
  let waitForMobileNavigation = $state(!inShell && narrow.current);
  const mobileRecovery = $derived(!inShell && (store.pairingRequired || (!store.core && store.connection !== 'ready'))
    && !workspace.machines.some(machine => machine.store.connection === 'ready'));
  // A fresh phone uses the pairing controls before fetching the conversations navigation.
  // An already paired page or one opened from a link can fetch navigation while it connects.
  const earlyPairing = $derived(narrow.current && mobileRecovery && store.pairingRequired
    && store.page === 'chat' && !mobileNavigation.current);
  // The machine the window opened on may still give way to one that answers.
  const booted = $derived(store.booted && desktopViewsSettled && !(workspace.waiting && store === workspace.primary)
    && (!waitForMobileNavigation || !narrow.current || earlyPairing || mobileNavigation.current !== undefined || mobileNavigation.failed));
  // A resize can load the phone's header without tearing down the already open page.
  $effect(() => {
    if (!narrow.current && booted) waitForMobileNavigation = false;
  });
  $effect(() => {
    if (!inShell && !MOBILE_BUILD && booted && workspace.machinesOr(store).some(({ store: machine }) => machine.client instanceof WsClient && machine.connection === 'ready')) {
      return warmOfflineConversations();
    }
  });
  // A core compacting its journal once before it serves: the start says so rather than only "Starting".
  let compacting = $state(false);
  $effect(() => {
    if (!inShell || booted) { compacting = false; return; }
    let live = true;
    const look = () => void shellStarting().then(starting => { if (live) compacting = starting?.phase === 'compacting'; });
    look();
    const timer = setInterval(look, 1000);
    return () => { live = false; clearInterval(timer); };
  });
  if (desktopStartup || !narrow.current || readStoredEndpoint() || opensFromLink()) {
    if (!inShell && narrow.current) loadMobileNavigation();
    if (desktopStartup) void activityPage.load().catch(() => undefined);
    const views = desktopStartup ? [sidebar, chatView, agentsLayout] : [sidebar, chatView];
    // Connect the core while the desktop's views load, then draw them together.
    void Promise.allSettled(views.map(view => view.load())).then(() => { desktopViewsSettled = true; });
  }
  $effect(() => {
    if (!inShell && narrow.current && store.booted && !earlyPairing) untrack(loadMobileNavigation);
  });
  // Wider than a phone (an iPhone on its side, a tablet, a desktop browser)
  // a lost or revoked pairing gets the same screen rather than a stale page.
  const wideRecovery = $derived(!narrow.current && mobileRecovery && store.pairingRequired && store.page !== 'settings');
  /** The page Settings was opened from, or the one on screen. */
  let settingsFrom = $state<Page>('chat');
  function leaveSettings() {
    if (settingsFrom === 'agents') store.showAgents();
    else if (settingsFrom === 'home') store.showHome();
    else store.showChat();
  }
  $effect.pre(() => {
    const page = store.page;
    if (page !== 'settings') settingsFrom = page;
    // Register the home before a settings detail mounts, including while the phone header loads.
    else if (!inShell && narrow.current && booted && !mobileRecovery) return mobileOverlay(leaveSettings);
  });
  /**
   * A phone's Settings opened from the chat is a layer over it, which stays built under it, hidden: leaving Settings
   * shows the list and the conversation as they were instead of building them again. From another page, Settings
   * replaces it as on a desktop, so no chat is built for nothing.
   */
  const phoneSettings = $derived(!inShell && narrow.current && store.page === 'settings' && settingsFrom === 'chat');
  /**
   * The chat is mounted but out of sight, under a phone's list, its recovery screen or its settings: the two
   * covers of `.body` below, which only a narrow window applies. A phone turned wide shows the chat again.
   */
  const chatCovered = $derived(phoneSettings || (!inShell && narrow.current && store.page === 'chat' && (mobileScreen !== 'chat' || mobileRecovery)));
  let documentVisible = $state(!document.hidden);
  // What the first screen does not draw stays out of the first chunk: the right
  // panel and its six surfaces, the palette and the two dialogs were a third of
  // it. Each loads the moment it is asked for, and the rest once the app has
  // booted and is idle, so a key pressed a second later finds them and the service
  // worker has them for a phone that loses its link. The tour is the same case
  // taken further: a device draws it once, then only when asked.
  const deferredLoaders = {
    RightPanel: () => import('./components/RightPanel.svelte'),
    CommandPalette: () => import('./components/CommandPalette.svelte'),
    ProjectPicker: () => import('./components/ProjectPicker.svelte'),
    ImportDialog: () => import('./components/ImportDialog.svelte'),
    ExportThreadDialog: () => import('./components/ExportThreadDialog.svelte'),
    ConnectFlow: () => import('./components/ConnectFlow.svelte'),
    Onboarding: () => import('./components/Onboarding.svelte'),
    // The drawer, then xterm.js and its stylesheet: only once a terminal is asked for.
    TerminalDrawer: () => import('./components/TerminalDrawer.svelte'),
    TerminalView: () => import('./components/TerminalView.svelte'),
    // The project board, in the same drawer: only once it is asked for.
    BoardDrawer: () => import('./components/BoardDrawer.svelte'),
    PluginUpdateNotice: () => import('./components/PluginUpdateNotice.svelte'),
    // A memory stop's corner card: only once a thread is open or a stop lands.
    MemoryCorner: () => import('./components/MemoryCorner.svelte'),
    // Plugin interfaces load after startup, on any link: what they add is part of the app.
    PluginUiHost: () => import('./components/PluginUiHost.svelte')
  };
  type Deferred = { [K in keyof typeof deferredLoaders]?: Awaited<ReturnType<(typeof deferredLoaders)[K]>>['default'] };
  let deferred = $state.raw<Deferred>({});
  const requested = new Set<keyof Deferred>();
  let boardShown = $derived(store.openThread !== null && store.boardShown && store.boardAvailable());
  // One drawer at a time: the board, when it holds the drawer, wins over a terminal left open.
  let terminalShown = $derived(store.openThread !== null && store.owner && store.terminalShown(store.openThread.id) && !boardShown);
  function need(name: keyof Deferred): void {
    if (requested.has(name)) return;
    requested.add(name);
    void deferredLoaders[name]()
      .then((module) => { deferred = { ...deferred, [name]: module.default }; })
      // Offline with a cold cache: the next ask tries again. A dialog that was
      // asked for is closed and said to be missing, or its open state would
      // hold the keyboard for something that never draws.
      .catch(() => {
        requested.delete(name);
        if (name === 'ProjectPicker' && store.projectPickerOpen) store.projectPickerOpen = false;
        else if (name === 'ImportDialog' && store.imports) store.closeImports();
        else if (name === 'ExportThreadDialog' && threadExport.request) closeThreadExport();
        else if (name === 'ConnectFlow' && store.connectDialog) store.closeConnect();
        else if (name === 'CommandPalette' && store.paletteOpen) store.paletteOpen = false;
        else return;
        store.error = strings.phone.dialogOffline;
      });
  }
  function needAll(): void {
    const names = Object.keys(deferredLoaders) as (keyof Deferred)[];
    for (const name of prefetchNames(names, { tourSeen: tourSeen(), owner: store.owner })) need(name);
  }
  // Once the first load has landed rather than against it, and the rest only on a
  // link that can spare the bytes (lib/prefetch.ts). The plugin update notice reads its own list, so it loads on any link.
  $effect(() => {
    if (!booted || earlyPairing) return;
    return whenIdle(() => { need('PluginUiHost'); if (!prefetchAllowed()) return need('PluginUpdateNotice'); needAll(); prefetchParts(); warmPages(store, experimentOn('resident-agents')); });
  });
  // With the first open thread, so the corner is there before a stop lands in it; a stop elsewhere asks for it too.
  $effect(() => { if (store.openThread || store.memoryStop) need('MemoryCorner'); });
  // The Whip's control, then its rope, the first time its switch in Appearance is on (lib/whip-entry.svelte.ts).
  $effect(() => {
    if (store.booted && featureOn('whip')) whipEntry.need(error => { store.error = String(error); });
  });
  // Browser profiles live on this computer, whichever machine is in view: they
  // are kept by the core this shell started (lib/browser-profiles.svelte.ts).
  $effect(() => {
    browserProfiles.source = workspace.machines.find((machine) => machine.store.localCore)?.store ?? store;
  });
  hostLocalAgentBrowser();
  let SettingsShell = $state<typeof import('./components/SettingsShell.svelte').default>();
  // Switched off with the page open: every machine goes back to its chat, so
  // switching it on again does not reopen a page nobody navigated to.
  $effect(() => {
    if (experimentOn('resident-agents')) return;
    for (const machine of workspace.machines) if (machine.store.page === 'agents') machine.store.showChat();
  });
  const contacts = contactsViews(() => store, () => workspace.machines, () => narrow.current);
  let settingsLoadError = $state('');
  $effect(() => {
    if (store.page !== 'settings' || SettingsShell) return;
    settingsLoadError = '';
    void import('./components/SettingsShell.svelte').then(module => { SettingsShell = module.default; })
      .catch(() => { settingsLoadError = strings.phone.settingsOffline; });
  });

  // A drawer left open before a reload or a reconnect opens again, with its tabs and splits.
  $effect(() => {
    const open = store.openThread;
    if (open !== null && store.owner && store.connection === 'ready') untrack(() => store.restoreTerminal(open.id));
  });

  // Asked for before the idle prefetch got to it: fetch it now. `need` fetches each part once.
  $effect(() => {
    if (panelSlot.shown) need('RightPanel');
    if (terminalShown) { need('TerminalDrawer'); need('TerminalView'); }
    if (boardShown) need('BoardDrawer');
    if (store.paletteOpen) need('CommandPalette');
    if (store.projectPickerOpen) need('ProjectPicker');
    if (store.imports) need('ImportDialog');
    if (threadExport.request) need('ExportThreadDialog');
    if (store.connectDialog) need('ConnectFlow');
    if (tour) need('Onboarding');
  });


  // This computer's own setting decides whether the window's updater installs by itself.
  $effect(() => { appUpdater.autoInstall = workspace.machines.find((machine) => machine.store.localCore)?.store.settings?.autoInstallUpdates === true; });

  onMount(() => {
    const stopViewport = startViewport();
    const stopRest = watchRest();
    const stopLoopPhase = watchLoopPhase();
    const stopInstall = listenForInstall();
    const stopAutoLink = agentAutoLink.start();
    // Another machine of the group reads this computer's app updates from its core.
    const stopDesktopReport = reportDesktopUpdates(() => workspace.machines.map((machine) => machine.store));
    const stopUpdates = watchUpdates(() => workspace.machines.map((machine) => machine.store));
    /** `away`: how long the page was gone, in ms; `remoteOnly`: the shell's own core and a page on its machine are left alone. */
    const resume = (away = 0, remoteOnly = false) => {
      if (document.hidden) return;
      for (const machine of workspace.machines) {
        const client = machine.store.client;
        if (client instanceof WsClient && (!remoteOnly || client.remote)) void client.resume(away).catch(() => undefined);
      }
    };
    const visibility = () => { documentVisible = !document.hidden; };
    // How long the page stayed away tells `resume()` whether to open a new socket at once.
    const stopAbsence = watchAbsence((away) => resume(away));
    const online = () => resume();
    // The system slept with the page in sight, a laptop closed on the app: every remote socket is checked as after that long away.
    const stopWake = watchWake((slept) => resume(slept, true));
    const offline = () => { for (const machine of workspace.machines) if (machine.store.client instanceof WsClient) machine.store.client.offline(); };
    // The app's page is public and every machine is on a private address: Chrome lets its sockets through once "Local network" is allowed.
    const stopLocalNetwork = appPage() ? localNetwork.start(() => resume()) : () => undefined;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    const notification = (event: MessageEvent) => { if (workspace.workerMessage(event.data)) mobileScreen = 'chat'; };
    navigator.serviceWorker?.addEventListener('message', notification);
    return () => {
      stopViewport();
      stopRest();
      stopLoopPhase();
      stopAutoLink();
      stopDesktopReport();
      stopInstall();
      stopUpdates();
      stopLocalNetwork();
      stopWake();
      stopAbsence();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      navigator.serviceWorker?.removeEventListener('message', notification);
    };
  });

  // The overlays of this file leave the way they arrived: one `--dur-2`
  // playing the reverse animation, then out of the DOM on `animationend`.
  const scrim = new Closing();
  const panelSlot = new Closing();
  const terminalSlot = new Closing();
  const boardSlot = new Closing();
  // Ctrl+Q quits the shell after a hold or a double press, never on one slip:
  // the hint shows for as long as the key is down. Only the shell has a
  // process to quit; a browser tab keeps its own Ctrl+Q.
  const quitHint = new Closing();
  let quitting = $state(false);
  const requestQuit = desktopQuit(() => closingStores(workspace.machines), () => { quitting = true; });
  onMount(() => { if (inShell) return installQuitGuard(requestQuit, error => { store.error = String(error); }); });
  const quitHold = inShell
    ? confirmedQuitHold(requestQuit, {
        onHolding: (holding) => {
          if (holding) quitHint.show();
          else quitHint.hide();
        },
        hasQuit: () => quitting,
        failed: error => { store.error = String(error); }
      })
    : null;

  $effect(() => {
    if (store.sidebarOpen) scrim.show();
    else scrim.hide();
  });

  /**
   * The thread the right panel belongs to: the chat's open thread, or on the
   * Agents page the agent's own; an ordinary thread left open behind the
   * Agents page has no panel there.
   */
  const panelThread = $derived(store.page === 'agents' ? (store.openThread?.agentSessionId ? store.openThread : null) : store.openThread);
  $effect(() => {
    if (store.panelOpen && panelThread) panelSlot.show();
    else panelSlot.hide();
  });
  $effect(() => {
    // The drawer opens once its chunk is here, so its opening animation plays whole.
    if (terminalShown && deferred.TerminalDrawer) terminalSlot.show();
    else {
      // The drawer goes inert as it leaves, which drops the focus on `<body>`:
      // the keyboard goes back to the composer first.
      if (document.activeElement?.closest('[data-testid=terminal-drawer]')) focusComposer();
      terminalSlot.hide();
    }
  });
  $effect(() => {
    if (boardShown && deferred.BoardDrawer) boardSlot.show();
    else {
      if (document.activeElement?.closest('[data-testid=board-drawer]')) focusComposer();
      boardSlot.hide();
    }
  });

  // On a phone the panel covers the chat: Back shuts it.
  $effect(() => {
    if (panelSlot.open) return mobileOverlay(() => store.panel.hide());
  });

  // The tray menu is native: it speaks the UI's language only when told, at
  // start and whenever the language changes.
  $effect(() => {
    if (!inShell) return;
    const labels = { show: strings.quotas.trayShow, quit: strings.quotas.trayQuit };
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('tray_labels', labels))
      .catch(() => {
        // An older shell without the command keeps its English menu.
      });
  });

  // The same for a push: the service worker shows the core's generic notices
  // in the words this page left it, written again when the language changes.
  $effect(() => {
    if (inShell) return;
    void storeNotificationWords(notificationWords());
    void storeWorkerLocale(activeLocale());
  });

  // Every http(s) link the UI shows goes to the system browser, once, from here.
  // The listener sits on the body, not the app root: the connect dialog, the
  // onboarding and the other overlays render beside `.app`, and the sign-in
  // link of the connect dialog did nothing in the shell when only `.app` listened.
  $effect(() => {
    const root = appRoot;
    if (!root) return;
    const stopLinks = installExternalLinks(root.ownerDocument.body);
    const stopDrops = installDropNavigationGuard(root);
    return () => { stopLinks(); stopDrops(); };
  });

  // What wants the user rides the document title, so the taskbar and a browser
  // tab say "(2) Boite" while the window is somewhere behind: the threads of
  // every connected machine that wait on an answer or finished unread. The
  // installed app's icon badge carries the same count.
  $effect(() => {
    const stores = workspace.machinesOr(store).map((machine) => machine.store);
    const count = attentionCount(stores);
    const name = appName();
    document.title = count > 0 ? `(${count}) ${name}` : name;
    if (!inShell) syncAppBadge(count);
  });

  onMount(() => {
    // A notification tapped with no window open: taken off the address at
    // once, so a reload during the boot does not jump there again.
    const tapped = takeNotificationTarget();
    const stopSettingsSync = workspace.settingsSync.start();
    const stopGroupLinks = workspace.groups.start();
    void workspace.bootAt(tapped);
    // The stored theme, and the OS one while the setting reads `system`.
    const stopTheme = startTheme();
    // The stored window material, which only the shell wears.
    startGlass();
    // A click on a toast opens the thread it was about.
    const stopToasts = onNotificationOpen((threadId) => void workspace.openNotification(threadId));
    // A mouse's back and forward buttons walk the threads, drafts and settings tabs shown.
    const stopViewHistory = startViewHistory();
    if (!inShell) {
      return () => {
        stopViewHistory();
        stopTheme();
        stopToasts();
        stopSettingsSync();
        stopGroupLinks();
        workspace.close();
      };
    }

    // A drag from the Explorer: the shell says what each path is, a folder
    // becomes a project and a file goes to the message being written.
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let stopTray: (() => void) | undefined;
    const traySettings = async (tab: 'accounts' | 'limits') => {
      const local = workspace.machines.find((machine) => machine.store.localCore)?.store;
      if (!local) return;
      await workspace.select(local);
      if (workspace.active === local) local.showSettings(tab);
    };
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stops = await Promise.all([
        listen('tray://providers', () => void traySettings('accounts')),
        listen('tray://limits', () => void traySettings('limits')),
      ]);
      const stop = () => stops.forEach((off) => off());
      if (disposed) stop(); else stopTray = stop;
    });
    void import('./lib/native-drop').then(async ({ listenNativeDrop }) => {
      const stop = await listenNativeDrop(workspace);
      if (disposed) stop(); else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
      stopTray?.();
      stopViewHistory();
      stopTheme();
      stopToasts();
      quitHold?.dispose();
      stopSettingsSync();
      stopGroupLinks();
      workspace.close();
    };
  });

  function onkeyup(event: KeyboardEvent) {
    // Whichever half of the chord lifts first ends the hold.
    if (quitHold && (event.key.toLowerCase() === 'q' || event.key === 'Control' || event.key === 'Meta')) {
      quitHold.release();
    }
  }

  function onblur() {
    quitHold?.release();
  }

  /*
   * The tour opens by itself the first time Boite runs on this device, and on
   * request afterwards. It waits for a core: its screens carry real switches,
   * and half of them would be dead against a connection that is not there.
   */
  /**
   * A folded column standing in the body, the one case where the chat card or
   * the Agents card keeps a left gap: both lists fold together (RailFrame). A class rather than `.body:has(> .sidebar.collapsed)`:
   * that selector made every node a streaming answer or a scroll mounted
   * anywhere below restyle the body, right before the list read its layout.
   */
  /**
   * The desktop's left edge: the app rail on every page, then the list column
   * (threads, bots, or the Settings pages, which never fold). Both reach the
   * window's top, so the main column's bar starts right of them.
   */
  let railShown = $derived(booted && !wideRecovery);
  let agentsRailShown = $derived(store.page === 'agents' && experimentOn('resident-agents') && !(store.connection === 'closed' && !store.core));
  // Before the first project the desktop draws no list column (lib/list-absent.ts): it counts as folded, with no toggle.
  let listGone = $derived(store.page !== 'settings' && !(store.page === 'agents' && experimentOn('resident-agents'))
    && listAbsent(workspace.machinesOr(store).map((machine) => machine.store), narrow.current));
  let listFolded = $derived((store.sidebarCollapsed || listGone) && store.page !== 'settings');
  let barLeft = $derived(!railShown ? '0px' : listFolded ? 'var(--frame-gap)'
    : `calc(${visibleSidebarWidth({ sidebarWidth: store.sidebarWidth, agentsSidebarWidth: store.agentsSidebarWidth, page: agentsRailShown ? 'agents' : 'chat' })}px + var(--frame-gap))`);
  let sidebarFolded = $derived(listFolded && store.booted);
  // A machine with no AI shows its one action first: the tour waits for something to show.
  let tour = $derived(store.booted && store.connection === 'ready' && (tourRequested() || (!tourSeen() && !needsAnAI(store))));

  /**
   * Whether something modal is up, waiting on the user: no app chord fires under
   * it. The tour counts once it is drawn: offline with a cold cache it never is,
   * and the keyboard must not stay held for it.
   */
  let modal = $derived((tour && deferred.Onboarding !== undefined) || confirm.current !== null || store.imports !== null || threadExport.request !== null || store.projectPickerOpen || (store.connectDialog !== null && deferred.ConnectFlow !== undefined));

  /**
   * Every app chord goes through the keyboard table (`lib/keybindings.ts`,
   * the defaults under the user's `keybindings.json`), so a moved key moves
   * here, in the palette hints and in the tooltips at once. The quit hold is
   * the one chord that stays where it is.
   */
  function onkeydown(event: KeyboardEvent) {
    handleAppKey(event, { store, inShell, modal, quitHold });
  }

</script>

<svelte:window {onkeydown} {onkeyup} {onblur} ononline={() => { if (mobileNavigation.failed) loadMobileNavigation(); }} />

{#each workspace.machines as machine (machine.id)}
  <ThreadPreparation store={machine.store} visible={machine.store === store && documentVisible && (inShell || mobileScreen === 'chat')} />
{/each}
{#if !workspace.machines.some(machine => machine.store === store)}
  <ThreadPreparation {store} visible={documentVisible && (inShell || mobileScreen === 'chat')} />
{/if}

<div class="app" class:shell={inShell} class:ready={booted} class:phone-chat={!inShell && !mobileRecovery && store.page === 'chat' && mobileScreen === 'chat'} class:off-chat={!inShell && store.page !== 'chat'} class:tabbed={!inShell && mobileTabs} class:railed={railShown} class:quitting style:--bar-left={barLeft} bind:this={appRoot}>
  {#if railShown}<AppRail {store} />{/if}
  {#if !inShell && booted}
    {#if earlyPairing}
      <MobilePairing {store} screen={mobileScreen} navigate={(screen) => { mobileScreen = screen; }} onpaired={() => { mobileScreen = 'threads'; }} />
    {:else if mobileNavigation.current}
      {@const MobileNavigation = mobileNavigation.current}
      <MobileNavigation {store} recover={mobileRecovery} onleavesettings={leaveSettings} bind:screen={mobileScreen} bind:tabbed={mobileTabs} />
    {:else if narrow.current && mobileNavigation.failed}
      <p class="mobile-navigation-failed" role="alert" data-testid="mobile-navigation-failed">
        <span>{strings.parts.navigationFailed}</span>
        <button type="button" data-testid="mobile-navigation-retry" onclick={() => void retryOrReload(() => mobileNavigation.load())}>{strings.common.retry}</button>
      </p>
    {/if}
  {/if}
  <TitleBar {store} edge={!railShown} listless={listGone} />

  <div class="body" class:under-settings={phoneSettings} class:mobile-covered={!inShell && store.page === 'chat' && (mobileScreen !== 'chat' || mobileRecovery)} class:panel-maximized={(store.page === 'chat' || store.page === 'agents') && rightPanel.maximized && !rightPanel.floating && store.panelOpen} class:sidebar-folded={sidebarFolded}>
    {#if !booted}
      <p class="empty boot" class:long={compacting}>{compacting ? strings.app.compacting : strings.app.loading}</p>
    {:else if earlyPairing}
      <!-- Pairing uses the phone's header and list slots above. -->
    {:else if wideRecovery}
      <div class="wide-recovery" data-testid="wide-recovery"><MobileConnect {store} onpaired={() => {}} /></div>
    {:else if store.page === 'settings' && !phoneSettings}
      <!-- Settings alone: its layer below takes the page. -->
    {:else if store.connection === 'closed' && !store.core}
      <Deferred part={sidebar}>{#snippet children(Sidebar)}<Sidebar {store} />{/snippet}</Deferred>
      <div class="notice framed">
        <h1>{strings.app.noEndpointTitle}</h1>
        <p class="muted">{strings.app.noEndpointBody}</p>
        <button type="button" class="primary" data-preload-view="settings" onclick={() => store.showSettings()}>
          {strings.app.openSettings}
        </button>
      </div>
    {:else if store.page === 'agents' && experimentOn('resident-agents')}
      <Deferred part={agentsLayout}>{#snippet children(AgentsLayout)}<AgentsLayout {store} panel={panelSlot} showPanel={panelSlot.shown && panelThread !== null} RightPanel={deferred.RightPanel} />{/snippet}</Deferred>
    {:else}
      <Deferred part={sidebar}>{#snippet children(Sidebar)}<Sidebar {store} />{/snippet}</Deferred>
      {#if scrim.shown}
        <button
          type="button"
          class="scrim"
          class:closing={scrim.closing}
          aria-label={strings.common.close}
          use:scrim.attach
          onanimationend={scrim.end}
          onclick={() => (store.sidebarOpen = false)}
        ></button>
      {/if}
      {#if store.page === 'home' && contactsShown(store)}
        <!-- Contacts take the chat's card; the list column turns to its Contacts side (Sidebar.svelte). -->
        <main><div class="thread-chat framed">
          {#if contacts.HomePage}{#key store}<contacts.HomePage {store} />{/key}{:else}<p class="empty">{contacts.homeError || strings.app.loading}</p>{/if}
        </div></main>
      {:else}
      <main>
        <div class="thread-chat framed">
          <!-- Desktop Activity is the card's page while the rail has it on (lib/inbox.svelte.ts). -->
          {#if inbox.open && !narrow.current}
            <Deferred part={activityPage}>{#snippet children(ActivityPage)}<ActivityPage {store} />{/snippet}</Deferred>
          {:else}
            {#key store}
              <Deferred part={chatView}>{#snippet children(ChatView)}<ChatView {store} covered={chatCovered} />{/snippet}</Deferred>
            {/key}
          {/if}
        </div>
        {#if terminalSlot.shown && store.openThread && deferred.TerminalDrawer}
          {@const TerminalDrawer = deferred.TerminalDrawer}
          {#key store}
            {#key store.openThread.id}
              <TerminalDrawer {store} threadId={store.openThread.id} cwd={store.openThread.cwd}
                view={deferred.TerminalView}
                closing={terminalSlot.closing} attach={terminalSlot.attach} onexit={terminalSlot.end} />
            {/key}
          {/key}
        {/if}
        {#if boardSlot.shown && store.openThread && deferred.BoardDrawer}
          {@const BoardDrawer = deferred.BoardDrawer}
          <!-- Not keyed on the thread: the board is the project's, the same in each of its threads. -->
          {#key store}
            <BoardDrawer {store} threadId={store.openThread.id}
              closing={boardSlot.closing} attach={boardSlot.attach} onexit={boardSlot.end} />
          {/key}
        {/if}
      </main>
      {#if panelSlot.shown && store.openThread && deferred.RightPanel}
        {@const RightPanel = deferred.RightPanel}
        {#key store}
          <RightPanel
            {store}
            panel={store.panel}
            closing={panelSlot.closing}
            attach={panelSlot.attach}
            onexit={panelSlot.end}
          />
        {/key}
      {/if}
      {/if}
      <!-- Not keyed on the machine: the column lists every machine's contacts, and a new one would slide in again.
           Not on the Contacts page: the list column's Contacts side holds the same rows there. -->
      {#if contacts.ContactsRail && contactsShown(store) && !narrow.current && store.page !== 'home'}<contacts.ContactsRail {store} />{/if}
    {/if}
    <!-- One place for Settings at every width: a resize that turns it into a layer over the chat, or back, keeps it
         built, so its screens keep their history entries in the order they were opened. Its pages' list takes the
         thread list's column, connected or not. -->
    {#if booted && store.page === 'settings'}
      <div class="settings-layer" class:over={phoneSettings}>
        {#if SettingsShell}<SettingsShell {store} onopenthread={() => { mobileScreen = 'chat'; }} />{:else}<p class="empty">{settingsLoadError || strings.app.loading}</p>{/if}
      </div>
    {/if}
  </div>

  {#if store.dropping}
    <DropOverlay kind={store.dropping} />
  {/if}

  <QuitHint {quitHint} />

  <!-- A missing or revoked phone pairing has its own recovery screen; Chrome refuses every socket until "Local network" is allowed, which that screen says too. -->
  <ErrorToast {store} pairingScreen={!inShell && (narrow.current || wideRecovery) && store.pairingRequired}
    blocked={mobileRecovery && localNetwork.state === 'denied'} onopen={() => { mobileScreen = 'chat'; }} />
  {#if inShell && store.canForceCoreRestart}
    <div class="toast-slot" use:toastSlot>
      <Notice icon={CircleAlert} tone="danger" floating role="alert" detail={strings.errors.coreUnresponsive} testid="core-recovery">
        {#snippet actions()}
          <button type="button" class="small" onclick={() => void store.forceCoreRestart()}>{strings.errors.forceCoreRestart}</button>
        {/snippet}
      </Notice>
    </div>
  {/if}
  <UndoToast onerror={(error) => (store.error = errorText(error))} />
  {#if (store.page === 'chat' || store.memoryStop) && deferred.MemoryCorner}{@const MemoryCorner = deferred.MemoryCorner}<MemoryCorner {store} chat={store.page === 'chat'} />{/if}
  {#if store.booted && featureOn('whip') && whipEntry.overlay}{@const WhipOverlay = whipEntry.overlay}
    <WhipOverlay onerror={(error) => (store.error = errorText(error))} />
  {/if}
</div>

<ContextMenu />
<MoveProjectPicker />
<DragGhost />
{#if tour && deferred.Onboarding}{@const Onboarding = deferred.Onboarding}<Onboarding {store} />{:else if deferred.PluginUpdateNotice}{@const PluginUpdateNotice = deferred.PluginUpdateNotice}<PluginUpdateNotice />{/if}
{#if deferred.PluginUiHost}{@const PluginUiHost = deferred.PluginUiHost}<PluginUiHost />{/if}
{#if deferred.ProjectPicker}{@const ProjectPicker = deferred.ProjectPicker}<ProjectPicker {store} />{/if}
<ConfirmDialog />
{#if deferred.ImportDialog}{@const ImportDialog = deferred.ImportDialog}<ImportDialog {store} />{/if}
{#if threadExport.request && deferred.ExportThreadDialog}
  {@const ExportThreadDialog = deferred.ExportThreadDialog}
  {#key threadExport.request}<ExportThreadDialog {...threadExport.request} onclose={closeThreadExport} />{/key}
{/if}
{#if deferred.ConnectFlow}{@const ConnectFlow = deferred.ConnectFlow}<ConnectFlow {store} />{/if}
{#if deferred.CommandPalette}{@const CommandPalette = deferred.CommandPalette}<CommandPalette {store} />{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
  }

  /* The whole app arriving is a fade: nothing inside it should look shifted. */
  .app.ready {
    animation: fade var(--dur-3) var(--ease-out-quint);
  }

  /* Settings lays out as the body's own child, unless it is the phone's layer over the chat. */
  .settings-layer { display: contents; }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
  }

  main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .thread-chat {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* The frame: the cards keep `--frame-gap` from the window's right and bottom
     edges and from each other. The rails on the left stand on the frame, so
     only a folded column (RailFrame) leaves the chat or Agents card a left gap
     to keep itself. */
  @media (min-width: 721px) {
    .app.railed { padding-left: var(--app-rail); }

    .body {
      gap: var(--frame-gap);
      padding: 0 var(--frame-gap) var(--frame-gap) 0;
    }

    /* The list column climbs over the bar's band to the window's top; the bar
       starts right of it (`--bar-left`). */
    .body > :global(.rail) { margin-top: calc(-1 * var(--titlebar)); }

    .body.sidebar-folded {
      padding-left: var(--frame-gap);
    }
  }

  /* Maximized, the panel takes the room and the chat column keeps none, not
     even its edge or the gap beside it. */
  .body.panel-maximized main {
    flex: none;
    width: 0;
    overflow: hidden;
    border: none;
    box-shadow: none;
    margin-right: calc(-1 * var(--frame-gap));
  }

  .boot {
    margin: auto;
  }
  .boot.long { max-width: 360px; padding: 0 24px; text-align: center; }

  .wide-recovery { flex: 1; min-width: 0; display: flex; overflow-y: auto; padding: 16px 24px; }
  .notice {
    flex: 1;
    min-width: 0;
    padding: 40px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .scrim {
    display: none;
  }

  /* The last frame before the process goes: nothing under the pointer answers. */
  .app.quitting {
    pointer-events: none;
    opacity: 0.6;
    transition: opacity var(--dur-2) var(--ease-out-quint);
  }

  .mobile-navigation-failed { display: none; }

  @media (max-width: 720px) {
    /* The navigation's place when its chunk did not load: it says so, with a retry. */
    .app:not(.shell) .mobile-navigation-failed { display: flex; grid-row: 1; grid-column: 1; align-items: center; gap: 10px; margin: 0; min-height: 60px; padding: max(8px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left)); border-bottom: 1px solid var(--color-border); color: var(--color-danger); }
    .mobile-navigation-failed button { flex: none; min-height: 44px; padding: 0 14px; border-radius: var(--radius-md); }
    /* Safari scrolls the document to reveal a focused field even with overflow
       hidden. Anchor the app to the viewport so its header does not leave with it. */
    .app:not(.shell) { position: fixed; left: 0; right: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr); height: var(--app-height, 100dvh); top: var(--app-top, 0px); overflow: hidden; }
    .app:not(.shell) :global(.titlebar) { display: none; grid-row: 2; grid-column: 1; }
    .app:not(.shell) .body { grid-row: 2; grid-column: 1; }
    /* A settings page brings its own header, with the way back: one header a screen, never two stacked. */
    .app:not(.shell):has(:global(.mobile-settings[data-detail])) > :global(.mobile-header) { display: none; }
    /* The header owns the top safe area; pages keep clear of the home indicator, unless the bottom bar (tabbed) does. */
    .app.off-chat:not(.tabbed) .body { padding-bottom: env(safe-area-inset-bottom, 0px); box-sizing: border-box; }
    /* Skips layout and paint of the chat streaming behind the list; its DOM, state and scroll stay as they were.
       Skipped content does not advance its animations, so the switch waits for the exits the cover started
       (a menu closing) to end, and lifts at once on return. */
    .body.mobile-covered { visibility: hidden; pointer-events: none; content-visibility: hidden; transition: content-visibility 0s var(--dur-whip) allow-discrete; }
    /* Settings over the chat it keeps: the chat is skipped like under the list, the layer takes the body's box. */
    .body.under-settings > :global(:not(.settings-layer)) { visibility: hidden; pointer-events: none; content-visibility: hidden; }
    .settings-layer.over { position: absolute; inset: 0; display: flex; min-height: 0; padding: inherit; box-sizing: border-box; }
    .scrim {
      display: block;
      position: fixed;
      inset: var(--titlebar) 0 0;
      z-index: 20;
      border: none;
      border-radius: 0;
      background: var(--color-scrim);
      height: auto;
      padding: 0;
      animation: fade var(--dur-2) var(--ease-out-quint);
    }

    .scrim.closing {
      animation-name: fade-out;
      pointer-events: none;
    }
  }
</style>
