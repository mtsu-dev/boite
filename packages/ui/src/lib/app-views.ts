import { LazyComponent } from './lazy-component.svelte';

/** One resolved component per chunk, shared by boot, pointer intent and render. */
export const appViews = {
  RightPanel: new LazyComponent(() => import('../components/RightPanel.svelte')),
  CommandPalette: new LazyComponent(() => import('../components/CommandPalette.svelte')),
  ProjectPicker: new LazyComponent(() => import('../components/ProjectPicker.svelte')),
  ImportDialog: new LazyComponent(() => import('../components/ImportDialog.svelte')),
  ConnectFlow: new LazyComponent(() => import('../components/ConnectFlow.svelte')),
  Onboarding: new LazyComponent(() => import('../components/Onboarding.svelte')),
  TerminalDrawer: new LazyComponent(() => import('../components/TerminalDrawer.svelte')),
  TerminalView: new LazyComponent(() => import('../components/TerminalView.svelte')),
  BoardDrawer: new LazyComponent(() => import('../components/BoardDrawer.svelte')),
  PluginUpdateNotice: new LazyComponent(() => import('../components/PluginUpdateNotice.svelte')),
  MemoryCorner: new LazyComponent(() => import('../components/MemoryCorner.svelte')),
  PluginUiHost: new LazyComponent(() => import('../components/PluginUiHost.svelte')),
};
