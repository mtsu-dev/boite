<script lang="ts">
  import type { Snippet } from 'svelte';
  import { panelTools } from '../lib/panel-tools.svelte';

  /**
   * A surface's own head: what it holds in words, then its actions. On a
   * desktop its node moves up into the panel's strip, between the tabs and the
   * close (`RightPanel.svelte`), so the panel has one head; on a phone, or a
   * surface shown alone, it is the body's first line (app.css `.panel-toolbar`).
   * The node moves, not the snippet: what it reads lives and dies with the
   * surface, so a leaving surface never draws its head from a tab it lost.
   */
  let { children }: { children: Snippet } = $props();
  const tools = panelTools();

  function place(node: HTMLElement): (() => void) | void {
    const slot = tools?.slot;
    if (!slot) return;
    // Its place in the body, kept for the way back (the strip gone, or the panel narrowed to a phone's).
    const mark = document.createComment('');
    node.before(mark);
    slot.append(node);
    return () => { if (mark.parentNode) mark.replaceWith(node); else node.remove(); };
  }
</script>

<div class:panel-toolbar={!tools?.slot} class:in-strip={!!tools?.slot} {@attach place}>{@render children()}</div>

<style>
  /* In the strip, its parts are the strip's own flex items. */
  .in-strip { display: contents; }
</style>
