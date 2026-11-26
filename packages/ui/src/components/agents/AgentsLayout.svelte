<script module lang="ts">
  type Page = typeof import('./AgentsPage.svelte').default;
  /** Kept past this layout's unmount, so coming back to Agents draws the page in its first frame. */
  let loaded: Page | undefined;
  let pending: Promise<Page> | null = null;

  /** Loads AgentsPage ahead of mount (prefetch, press-preload) so the first visit renders on frame 0. */
  export function preloadAgentsPage(): Promise<Page> {
    if (loaded) return Promise.resolve(loaded);
    pending ??= import('./AgentsPage.svelte')
      .then((module) => {
        loaded = module.default;
        return loaded;
      })
      .finally(() => { pending = null; });
    return pending;
  }
</script>

<script lang="ts">
  import type { Closing } from '../../lib/closing.svelte';
  import type { Store } from '../../lib/store.svelte';
  import { strings } from '../../lib/strings';
  import type RightPanelView from '../RightPanel.svelte';
  import ThreadLoading from '../ThreadLoading.svelte';

  /**
   * The Agents page in the app's body: the chat's layout with the agents list
   * for its column. An agent's conversation is its thread, and the panel
   * beside it that thread's, drawn once the app has its chunk. The page itself
   * loads the first time it is shown.
   */
  let { store, panel, showPanel, RightPanel }: {
    store: Store;
    panel: Closing;
    /** The panel slot is open and the open thread is an agent's. */
    showPanel: boolean;
    RightPanel: typeof RightPanelView | undefined;
  } = $props();

  let AgentsPage = $state<Page | undefined>(loaded);
  let loadError = $state('');
  $effect(() => {
    if (AgentsPage) return;
    void preloadAgentsPage().then((page) => { AgentsPage = page; })
      .catch(() => { loadError = strings.agents.offline; });
  });
</script>

{#if AgentsPage}{#key store}<AgentsPage {store} />{/key}{:else if loadError}<p class="empty">{loadError}</p>{:else}<main class="agents-main"><div class="agents-card framed"><ThreadLoading progress={null} /></div></main>{/if}
{#if showPanel && RightPanel}
  {#key store}
    <RightPanel {store} panel={store.panel} closing={panel.closing} attach={panel.attach} onexit={panel.end} />
  {/key}
{/if}
