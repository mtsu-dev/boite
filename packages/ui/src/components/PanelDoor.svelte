<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { PanelRight } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * The door to the side panel, named in words with how many panels it holds,
   * the same on a thread's header and a bot's: outlined so its word reads as a
   * button, filled while the panel is open. The panel's own selector lists
   * every panel and tool once it is open. `ontoggle` is what the view opens it
   * on (a bot's opens on its desk).
   */
  let { store, count, ontoggle, testid }: { store: Store; count: number; ontoggle: () => void; testid: string } = $props();
  const mobile = new MediaQuery('(max-width: 720px)');
</script>

<span class="panel-door" class:on={store.panelOpen}>
  <button type="button" class="ghost door" title={`${strings.thread.panelHint}${store.keyHint('panel')}`} aria-pressed={store.panelOpen} data-testid={testid} onclick={ontoggle}>
    <span class="door-face">
      {#if !mobile.current}<PanelRight size={16} strokeWidth={1.75} aria-hidden="true" />{/if}
      <span class="ui-label">{strings.thread.panelMenu}</span>
      {#if count > 0}<span class="door-count" data-testid="panel-toggle-count">{count}</span>{/if}
    </span>
  </button>
</span>

<style>
  /* Off the window's edge by the gap the crumb keeps on the left. */
  .panel-door { display: inline-flex; flex: none; align-items: center; margin-right: 4px; }
  /* 32 px high as the title's menu and the sidebar fold; on a phone the button around the face keeps the touch height. */
  .door { display: inline-flex; align-items: center; height: 32px; padding: 0; background: none; border: none; }
  .door-face { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--color-edge); border-radius: var(--radius-md); font-size: var(--text-meta); white-space: nowrap; }
  @media (hover: hover) {
    .door:hover:not(:disabled) { background: none; }
    .door:hover .door-face { background: var(--color-surface-3); color: var(--color-foreground); }
  }
  .on .door-face { background: var(--color-active); color: var(--color-foreground); }
  .door-count { min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; display: grid; place-items: center; border-radius: var(--radius-full); background: var(--color-surface-3); color: var(--color-foreground); font-variant-numeric: tabular-nums; }
  @media (max-width: 720px) {
    .door { height: var(--touch-target); }
  }
</style>
