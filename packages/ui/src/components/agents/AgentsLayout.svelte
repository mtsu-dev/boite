<script lang="ts">
  import type { Closing } from '../../lib/closing.svelte';
  import type { Store } from '../../lib/store.svelte';
  import { strings } from '../../lib/strings';
  import type RightPanelView from '../RightPanel.svelte';
  import ThreadLoading from '../ThreadLoading.svelte';
  import Deferred from '../Deferred.svelte';
  import { agentsPage as lazyAgentsPage } from '../../lib/agents-views';
  import { rightPanel } from '../../lib/right-panel.svelte';

  /**
   * The Agents page in the app's body: the chat's layout with the agents list
   * for its column. An agent's conversation is its thread, and the panel
   * beside it that thread's, drawn once the app has its chunk. The page itself
   * loads the first time it is shown.
   */
  let { store, panel, showPanel, RightPanel, panelFailure }: {
    store: Store;
    panel: Closing;
    /** The panel slot is open and the open thread is an agent's. */
    showPanel: boolean;
    RightPanel: typeof RightPanelView | undefined;
    panelFailure?: () => void;
  } = $props();

</script>

<Deferred part={lazyAgentsPage}>
  {#snippet pending()}<main class="agents-main"><div class="agents-card framed"><ThreadLoading progress={null} /></div></main>{/snippet}
  {#snippet children(AgentsPage)}{#key store}<AgentsPage {store} />{/key}{/snippet}
</Deferred>
{#if showPanel && RightPanel}
  {#key store}
    <RightPanel {store} panel={store.panel} closing={panel.closing} attach={panel.attach} onexit={panel.end} />
  {/key}
{:else if showPanel}
  <aside class="cold-panel framed" style:width={String(rightPanel.width) + 'px'}>{#if panelFailure}<p role="alert">{strings.parts.failed} <button type="button" onclick={panelFailure}>{strings.common.retry}</button></p>
  {:else}<p role="status" aria-busy="true">{strings.parts.loading}</p>{/if}</aside>
{/if}

<style>
  .cold-panel { flex: none; max-width: 45%; }
  .cold-panel p { margin: 1rem; color: var(--color-muted-foreground); }
  @media (max-width: 720px) { .cold-panel { position: absolute; inset: 0; width: 100% !important; max-width: none; z-index: 5; } }
</style>
