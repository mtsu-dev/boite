<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { PanelRight } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  import { panelSwitch } from '../lib/panel-switch.svelte';
  import type { Store } from '../lib/store.svelte';

  /**
   * The door to the side panel, the same on a thread's header and a bot's.
   * On a desktop it is the panel glyph alone, pressed while the panel is open:
   * a click opens the panel, the next one closes it. The panel's own strip
   * holds its tabs and the launcher that adds one (`RightPanel.svelte`).
   * On a phone it reads "Panels" and how many it holds; the phone's panel
   * covers the header, so its own head carries the door (`inPanel`), which
   * names the showing panel and switches it (`PanelSwitcher.svelte`, handed
   * over by `RightPanel.svelte` through `lib/panel-switch.svelte.ts`).
   * `ontoggle` is what the door opens and closes (a bot's opens on its desk).
   */
  let { store, count = 0, ontoggle, testid, inPanel = false }: { store: Store; count?: number; ontoggle?: () => void; testid: string; inPanel?: boolean } = $props();
  const mobile = new MediaQuery('(max-width: 720px)');
  const named = $derived(inPanel && store.panelOpen && panelSwitch.store === store);
</script>

{#if !mobile.current && !inPanel}
  <button type="button" class="icon-button panel-glyph" title={`${strings.thread.panelHint}${store.keyHint('panel')}`} aria-label={strings.thread.panelHint}
    aria-pressed={store.panelOpen} data-testid={testid} onclick={() => ontoggle?.()}>
    <PanelRight size={16} strokeWidth={1.75} />
  </button>
{:else}
<span class="panel-door" class:on={named} class:in-panel={inPanel}>
  {#if named && panelSwitch.door}
    <panelSwitch.door {inPanel} />
  {:else}
    <!-- Open with its panel still loading, the door stays pressed; its name comes with the panel. -->
    <button type="button" class="ghost door" title={`${strings.thread.panelHint}${store.keyHint('panel')}`} aria-pressed={store.panelOpen} data-testid={testid} onclick={() => ontoggle?.()}>
      <span class="door-face">
        {#if !mobile.current}<PanelRight size={16} strokeWidth={1.75} aria-hidden="true" />{/if}
        <span class="ui-label">{strings.thread.panelMenu}</span>
        {#if count > 0}<span class="door-count" data-testid="panel-toggle-count">{count}</span>{/if}
      </span>
    </button>
  {/if}
</span>
{/if}

<style>
  /* Off the window's edge by the gap the crumb keeps on the left, its 32 px target kept. */
  .panel-glyph { flex: none; margin: calc((var(--icon-button-target) - var(--icon-button)) / 2); margin-right: 4px; }
  /* Off the window's edge by the gap the crumb keeps on the left. */
  .panel-door { display: inline-flex; flex: none; min-width: 0; align-items: center; margin-right: 4px; }
  /* 32 px high as the title's menu and the sidebar fold; on a phone the button around the face keeps the touch height. */
  .door, .panel-door :global(.menu .trigger.ghost) { display: inline-flex; align-items: center; width: auto; min-width: 0; height: var(--control-head); padding: 0; background: none; border: none; color: inherit; }
  .panel-door :global(.menu) { min-width: 0; }
  .panel-door :global(.door-face) { display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: var(--control-head); padding: 0 10px; box-sizing: border-box; border: 1px solid var(--color-edge); border-radius: var(--radius-md); font-size: var(--text-meta); white-space: nowrap; }
  .panel-door :global(.door-face > svg) { flex: none; }
  .panel-door :global(.name) { min-width: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
  @media (hover: hover) {
    .door:hover:not(:disabled), .panel-door :global(.trigger.ghost:hover) { background: none; }
    .door:hover :global(.door-face), .panel-door :global(.trigger:hover .door-face) { background: var(--color-surface-3); color: var(--color-foreground); }
  }
  /* Open: the face filled as the pressed thing it is, the panel's name in full ink. */
  .on :global(.door-face), .door[aria-pressed='true'] :global(.door-face), .panel-door :global(.trigger[aria-expanded='true'] .door-face) { background: var(--color-active); color: var(--color-foreground); }
  .on :global(.door-face) { padding: 0 8px 0 10px; gap: 6px; }
  .door-count { flex: none; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; display: grid; place-items: center; border-radius: var(--radius-full); background: var(--color-surface-3); color: var(--color-foreground); font-variant-numeric: tabular-nums; }
  @media (max-width: 720px) {
    .door, .panel-door :global(.menu .trigger.ghost) { height: var(--touch-target); }
    /* In the phone panel's head: the panel's name at the head's reading size, beside the thread's title. */
    .in-panel { margin-right: 0; }
    .in-panel :global(.door-face) { height: 36px; font-size: var(--text-sm); }
    .in-panel :global(.name) { max-width: 150px; }
  }
</style>
