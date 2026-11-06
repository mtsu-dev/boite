<script lang="ts">
  import { controlMenu, CONTROLS_SECTION } from '../lib/controls';
  import type { ControlId } from '../lib/work-prefs.svelte';
  import type { BoundPanel, Surface, SurfaceKind } from '../lib/right-panel.svelte';
  import type { Store } from '../lib/store.svelte';
  import BrowserSurface from './BrowserSurface.svelte';
  import AgentBrowserSurface from './AgentBrowserSurface.svelte';
  import DelegationSurface from './DelegationSurface.svelte';
  import AgentMessagesSurface from './AgentMessagesSurface.svelte';
  import ChangesSurface from './ChangesSurface.svelte';
  import DeviceSurface from './DeviceSurface.svelte';
  import WindowSurface from './WindowSurface.svelte';
  import FileSurface from './FileSurface.svelte';
  import FilesSurface from './FilesSurface.svelte';
  import SurfaceLauncher from './SurfaceLauncher.svelte';
  import TasksSurface from './TasksSurface.svelte';
  import TraceSurface from './TraceSurface.svelte';
  import AgentDesk from './agents/AgentDesk.svelte';
  import CouncilSalon from './council/CouncilSalon.svelte';

  /** What the panel's tab in front shows, or the launcher while no tab is open. */
  let { store, panel, active, available, onlaunch }: {
    store: Store;
    panel: BoundPanel;
    active: Surface | null | undefined;
    available: (kind: SurfaceKind) => boolean;
    onlaunch: (kind: SurfaceKind) => void;
  } = $props();
</script>

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
{:else if active?.kind === 'council' && active.councilId}
  <!-- One salon per council: the tab moved to another council starts its reading afresh. -->
  {#key active.councilId}<CouncilSalon {store} councilId={active.councilId} threadId={panel.threadId ?? undefined} />{/key}
{:else}
  <SurfaceLauncher
    {available}
    {onlaunch}
    onmenu={(event, kind) => controlMenu(event, store, `panel.${kind}` as ControlId)}
    oncustomize={() => store.showSettings('appearance', CONTROLS_SECTION)}
  />
{/if}
