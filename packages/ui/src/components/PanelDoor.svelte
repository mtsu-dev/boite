<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { PanelRight, PanelRightClose } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * The door to the side panel, the same on a thread's header and a bot's,
   * outlined so its words read as a button. The open panel is named once, by
   * its own selector in the panel's head: while the panel shows, the door is a
   * pressed square with the close glyph, no name; closed, "Panels" and how
   * many it holds, so the way back says what it opens.
   * `ontoggle` is what the view opens it on (a bot's opens on its desk).
   */
  let { store, count, ontoggle, testid }: { store: Store; count: number; ontoggle: () => void; testid: string } = $props();
  const mobile = new MediaQuery('(max-width: 720px)');
</script>

<span class="panel-door" class:on={store.panelOpen}>
  <button type="button" class="ghost door" title={`${strings.thread.panelHint}${store.keyHint('panel')}`} aria-label={store.panelOpen ? strings.thread.panelMenu : undefined} aria-pressed={store.panelOpen} data-testid={testid} onclick={ontoggle}>
    <span class="door-face">
      {#if store.panelOpen}
        <PanelRightClose size={16} aria-hidden="true" />
      {:else}
        {#if !mobile.current}<PanelRight size={16} strokeWidth={1.75} aria-hidden="true" />{/if}
        <span class="ui-label">{strings.thread.panelMenu}</span>
        {#if count > 0}<span class="door-count" data-testid="panel-toggle-count">{count}</span>{/if}
      {/if}
    </span>
  </button>
</span>

<style>
  /* Off the window's edge by the gap the crumb keeps on the left. */
  .panel-door { display: inline-flex; flex: none; min-width: 0; align-items: center; margin-right: 4px; }
  /* 32 px high as the title's menu and the sidebar fold; on a phone the button around the face keeps the touch height. */
  .door { display: inline-flex; align-items: center; min-width: 0; height: var(--control-head); padding: 0; background: none; border: none; }
  .door-face { display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: var(--control-head); padding: 0 10px; box-sizing: border-box; border: 1px solid var(--color-edge); border-radius: var(--radius-md); font-size: var(--text-meta); white-space: nowrap; }
  .door-face > :global(svg) { flex: none; }
  @media (hover: hover) {
    .door:hover:not(:disabled) { background: none; }
    .door:hover .door-face { background: var(--color-surface-3); color: var(--color-foreground); }
  }
  /* Pressed: a square as tall as the header's other controls, filled. */
  .on .door-face { width: var(--control-head); padding: 0; justify-content: center; background: var(--color-active); color: var(--color-foreground); }
  .door-count { flex: none; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; display: grid; place-items: center; border-radius: var(--radius-full); background: var(--color-surface-3); color: var(--color-foreground); font-variant-numeric: tabular-nums; }
  @media (max-width: 720px) {
    .door { height: var(--touch-target); }
  }
</style>
