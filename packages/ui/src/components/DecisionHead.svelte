<script lang="ts">
  import type { Snippet } from 'svelte';
  import { strings } from '../lib/strings';

  /**
   * The one head of every decision in the composer: an ask to run a tool, a
   * question, a subagent's question. A live dot says it waits on the owner
   * (its name for screen readers and on hover), the decision follows in
   * bold on its own column, its controls sit in a compact group at the end.
   * No "Needs you" word: the dot and the place say it. A narrow box sends the
   * controls to a row of their own under the decision rather than squeezing
   * it. `as` makes the whole head one button, the rest of the props go on its root.
   */
  let { as = 'div', class: extra = '', children, end, ...rest }: { as?: 'div' | 'button'; class?: string; children: Snippet; end?: Snippet; [key: string]: unknown } = $props();
</script>

<svelte:element this={as} {...rest} class={['decision-head', extra]} type={as === 'button' ? 'button' : undefined}>
  <span class="title"><span class="mark" role="img" aria-label={strings.chat.permissionNeedsYou} title={strings.chat.permissionNeedsYou}></span>{@render children()}</span>
  {#if end}<span class="end">{@render end()}</span>{/if}
</svelte:element>

<style>
  .decision-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 8px; width: 100%; min-width: 0; margin: 0; padding: 0; color: var(--color-foreground); text-align: left; }
  /* The composer's row form (Composer sets `--dock-row`, `--dock-icon` and
     `--dock-type`, AgentDock draws the same rows): the dot in the icon box,
     the decision in bold in the ink, one row high; a question longer than a
     line pads its own top. Outside the composer, the controls' sizes. */
  .title { display: flex; align-items: center; gap: 8px; flex: 1 1 var(--decision-title, 12rem); min-width: 0; min-height: var(--dock-row, var(--control)); font-size: var(--dock-type, var(--text-base)); font-weight: 600; line-height: 20px; }
  .mark { display: flex; align-items: center; justify-content: center; flex: none; align-self: flex-start; width: var(--dock-icon, 6px); height: var(--dock-row, var(--control)); }
  .mark::before { content: ''; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--color-live); }
  .end { display: flex; align-items: center; gap: 4px; flex: none; min-height: var(--dock-row, var(--control)); margin-left: auto; }
</style>
