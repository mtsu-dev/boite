<script lang="ts">
  // The foot's first row while a permission waits on its command row out of
  // view (`lib/decision-tail.svelte.ts`): what waits, by its title, and Show,
  // which scrolls back to it. It only leads there: the row keeps Deny and
  // Allow once. A question needs no row: it stands at the top of the composer.
  import { decisionTail, showDecision } from '../lib/decision-tail.svelte';
  import { decisionTitle } from '../lib/decision-title';
  import { fill, strings } from '../lib/strings';
  import { wordFit } from '../lib/word-fit';

  /** The oldest waiting permission, named by its title (`lib/decision-title.ts`). */
  let { permission }: { permission: { toolName: string; input: unknown } } = $props();
  let title = $derived(decisionTitle(permission.toolName, permission.input));

  let lead = $derived(decisionTail.count === 1 ? strings.composer.footDecision : fill(strings.composer.footDecisions, { count: String(decisionTail.count) }));
</script>

{#if decisionTail.away && decisionTail.count > 0}
  <div class="foot-row decision" data-testid="decision-pill" role="status">
    <span class="dot" aria-hidden="true"></span>
    <span class="lead ui-label">{lead}</span>
    <span class="title" data-testid="decision-pill-title" title={title} use:wordFit={title}></span>
    <button type="button" class="small text show" data-testid="decision-pill-show" title={strings.composer.footShowHint} onclick={() => showDecision()}>{strings.composer.footShow}</button>
  </div>
{/if}

<style>
  .decision { color: var(--color-muted-foreground); }
  /* Amber says "needs you", as on the command row. */
  .dot { flex: none; width: 6px; height: 6px; margin: 0 5px; border-radius: var(--radius-full); background: var(--color-live); }
  .lead { flex: none; white-space: nowrap; }
  /* One line cut between words (lib/word-fit.ts); the browser cuts only a first word too wide alone. */
  .title { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--color-foreground); font-weight: 550; }
  .show { flex: none; margin-left: auto; color: var(--color-foreground); font-weight: 550; }
  @media (max-width: 720px) { .show { position: relative; } .show::after { content: ''; position: absolute; inset: -8px -4px; } }
</style>
