<script lang="ts">
  import type { Snippet } from 'svelte';
  import { strings } from '../lib/strings';

  /**
   * The one head of every decision in the composer: an ask to run a tool, a
   * question, a subagent's question. A live dot says it waits on the owner
   * (its name for screen readers and on hover), the decision follows in
   * bold, its own controls sit at the end. No "Needs you" word: the dot and
   * the place say it. A narrow box sends the controls to a row of their own
   * under the decision rather than squeezing it. `flow` keeps the controls on
   * the decision's first line at every width and lets a long decision wrap
   * under them, for prose such as a question. `as` makes the whole head one
   * button, the rest of the props go on its root.
   */
  let { as = 'div', class: extra = '', flow = false, children, end, ...rest }: { as?: 'div' | 'button'; class?: string; flow?: boolean; children: Snippet; end?: Snippet; [key: string]: unknown } = $props();
</script>

<svelte:element this={as} {...rest} class={['decision-head', extra]} class:flow type={as === 'button' ? 'button' : undefined}>
  <!-- A float comes before the words it sits beside. -->
  {#if end && flow}<span class="end">{@render end()}</span>{/if}
  <span class="title"><span class="mark" role="img" aria-label={strings.chat.permissionNeedsYou} title={strings.chat.permissionNeedsYou}></span>{@render children()}</span>
  {#if end && !flow}<span class="end">{@render end()}</span>{/if}
</svelte:element>

<style>
  .decision-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 8px; width: 100%; min-width: 0; margin: 0; padding: 0; color: var(--color-foreground); text-align: left; }
  /* One controls' row high: a one-line decision sits in its middle, the dot
     beside its first line (a question longer than a line pads its own top). */
  .title { display: flex; align-items: center; gap: 8px; flex: 1 1 var(--decision-title, 12rem); min-width: 0; min-height: var(--control); font-size: var(--text-base); font-weight: 600; line-height: 22px; }
  .mark { flex: none; align-self: flex-start; width: 6px; height: 6px; margin-top: calc(var(--control) / 2 - 3px); border-radius: var(--radius-full); background: var(--color-live); }
  .end { display: flex; align-items: center; gap: 4px; flex: none; min-height: var(--control); margin-left: auto; }
  /* The controls float at the first line's end; the words fill beside them,
     then the whole width under them, every line indented past the dot. */
  .flow { display: flow-root; }
  .flow .end { float: right; margin-left: 8px; }
  .flow .title { display: block; position: relative; padding-left: 14px; }
  .flow .mark { position: absolute; left: 0; top: 0; }
</style>
