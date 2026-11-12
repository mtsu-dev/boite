<script lang="ts">
  import { Puzzle } from '@lucide/svelte';
  import { pluginUi } from '../lib/plugin-ui.svelte';
  import { fill, strings } from '../lib/strings';

  /** A plugin's panel tab: its script draws into the element, and its cleanup runs when the tab goes. */
  let { tab, threadId }: { tab: string; threadId: string | null } = $props();

  let entry = $derived(pluginUi.tab(tab));
  let plugin = $derived(tab.split('/')[0] ?? tab);
  let host = $state<HTMLElement>();

  $effect(() => {
    const element = host;
    const current = entry;
    if (!element || !current) return;
    const cleanup = current.mount(element, { threadId });
    return () => {
      cleanup?.();
      element.replaceChildren();
    };
  });
</script>

{#if entry}
  <div class="plugin-tab" data-testid="plugin-tab" data-plugin-tab={tab} bind:this={host}></div>
{:else}
  <div class="plugin-gone" data-testid="plugin-tab-gone">
    <Puzzle size={22} strokeWidth={1.75} />
    <p>{fill(strings.pluginUi.tabGone, { name: pluginUi.name(plugin) })}</p>
  </div>
{/if}

<style>
  .plugin-tab {
    height: 100%;
    overflow: auto;
    padding: 12px;
  }
  .plugin-gone {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--color-muted-foreground);
    text-align: center;
    padding: 24px;
  }
</style>
