<script lang="ts">
  // The foot's first row while a permission waits on its command row out of
  // view (`lib/decision-tail.svelte.ts`): what waits, by its title, and the
  // decision's own pair at its end (`DecisionActions`, the transcript's verbs),
  // so it is decided here in one press. The title scrolls back to the full
  // row. A question needs no row: it stands at the top of the composer.
  import { decisionTail, showDecision } from '../lib/decision-tail.svelte';
  import { decisionTitle } from '../lib/decision-title';
  import { fill, strings } from '../lib/strings';
  import { wordFit } from '../lib/word-fit';
  import DecisionActions from './DecisionActions.svelte';

  let { permission, answer }: {
    /** The oldest waiting permission, named by its title (`lib/decision-title.ts`). */
    permission: { id: string; toolName: string; input: unknown };
    /** Sends the decision for `permission`; false, or a promise of false, gives the buttons back. */
    answer: (decision: 'allow' | 'deny') => unknown;
  } = $props();
  let title = $derived(decisionTitle(permission.toolName, permission.input));

  let lead = $derived(decisionTail.count === 1 ? strings.composer.footDecision : fill(strings.composer.footDecisions, { count: String(decisionTail.count) }));

  /** The permission whose answer is on its way: both buttons stay down until it lands, a newer one gets them back. */
  let sending = $state<string | null>(null);
  async function choose(choice: 'allow' | 'deny'): Promise<void> {
    if (sending === permission.id) return;
    const id = permission.id;
    sending = id;
    if ((await answer(choice)) === false && sending === id) sending = null;
  }
</script>

{#if decisionTail.away && decisionTail.count > 0}
  <div class="foot-row decision" data-testid="decision-pill" role="group" aria-label={`${lead} ${title}`}>
    <button type="button" class="ghost show" data-testid="decision-pill-show" title={strings.composer.footShowHint} onclick={() => showDecision()}>
      <span class="dot" aria-hidden="true"></span>
      <span class="lead ui-label">{lead}</span>
      <span class="title" data-testid="decision-pill-title" title={title} use:wordFit={title}></span>
    </button>
    <DecisionActions>
      <button type="button" class="secondary small" data-testid="decision-pill-deny" title={strings.chat.denyKey} disabled={sending === permission.id} onclick={() => void choose('deny')}>
        <span class="ui-label">{strings.chat.deny}</span>
      </button>
      <button type="button" class="primary small" data-testid="decision-pill-allow" title={strings.chat.allowOnceKey} disabled={sending === permission.id} onclick={() => void choose('allow')}>
        <span class="ui-label">{strings.chat.allowOnce}</span>
      </button>
    </DecisionActions>
  </div>
{/if}

<style>
  /* A row as tall as its pair needs; on a short line the pair drops under the title (DecisionActions wraps).
     Scoped under the foot's own row rule (`ComposerFoot`), which fixes one height. */
  :global(.foot .foot-row).decision { height: auto; min-height: var(--foot-row); flex-wrap: wrap; row-gap: 0; padding-block: 3px; color: var(--color-muted-foreground); }
  /* The title is the way back to the full row: the row's words, no frame, the pointer's lift. */
  .show { display: flex; align-items: center; gap: 8px; flex: 1 1 12rem; min-width: 0; height: auto; min-height: calc(var(--foot-row) - 6px); margin-left: -8px; padding: 0 8px; justify-content: flex-start; border-radius: var(--radius-sm); color: inherit; font: inherit; font-weight: 400; }
  /* Amber says "needs you", as on the command row. */
  .dot { flex: none; width: 6px; height: 6px; margin: 0 5px; border-radius: var(--radius-full); background: var(--color-live); }
  .lead { flex: none; white-space: nowrap; }
  /* One line cut between words (lib/word-fit.ts); the browser cuts only a first word too wide alone. */
  .title { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--color-foreground); font-weight: 550; text-align: left; }
  .decision > :global(.decision-actions) { flex: 0 0 auto; margin-left: auto; }
  /* A phone: 40 px targets, and the title on its own line above them when the row is short. */
  @media (max-width: 720px) {
    /* The foot's 2 px end suits a ghost Stop; a filled button keeps the frame's gap off its edge. */
    :global(.foot .foot-row).decision { padding-block: 4px; padding-right: 8px; row-gap: 4px; }
    .show { flex-basis: 14rem; min-height: 36px; margin-left: -6px; padding: 0 6px; }
    .decision :global(.decision-actions > button) { height: 40px; padding-inline: 16px; }
  }
</style>
