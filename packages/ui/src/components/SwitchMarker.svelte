<script lang="ts">
  import { ArrowRight, ChevronRight } from '@lucide/svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import { handoverDetail, switchSuffix, switchWords, type SwitchNames, type SwitchShown } from '../lib/switch-notice';
  import { strings } from '../lib/strings';

  /**
   * A change of model, effort, speed or account in a thread's timeline: one
   * thin line above the turn that first ran on it, each side saying only what
   * changed, with its agent's mark. A change that needed a new native session
   * says the context was handed over and unfolds on what went. `pending`
   * draws the line dashed at the foot of the thread: picked, not used yet.
   */
  let { names, shown, pending = false }: { names: SwitchNames; shown: SwitchShown; pending?: boolean } = $props();
  let open = $state(false);
  const words = $derived(switchWords(names, shown));
  const suffix = $derived(pending ? [] : switchSuffix(names, shown));
  const detail = $derived(!pending && shown.handover ? handoverDetail(shown.handover) : null);
</script>

{#snippet line()}
  <span class="side"><ProviderLogo providerId={shown.from.providerId} size={13} />{#if words.lead}<span class="lead">{words.lead}</span>{/if}<span data-testid="switch-from">{words.from}</span></span>
  <span class="arrow" aria-hidden="true"><ArrowRight size={12} /></span>
  <span class="side">{#if words.agents}<ProviderLogo providerId={shown.to.providerId} size={13} />{/if}<span class="to" data-testid="switch-to">{words.to}</span></span>
  {#if suffix.length}<span class="break" aria-hidden="true"></span>{/if}
  {#each suffix as said, index (said)}<span class="said" class:first={index === 0}>{said}</span>{/each}
{/snippet}

<div class="change" class:pending data-testid={pending ? 'switch-pending' : 'switch-marker'} data-reason={shown.reason} title={pending ? strings.chat.switched.pending : undefined}>
  <span class="rule"></span>
  {#if detail}
    <button type="button" class="ghost small label" data-testid="switch-marker-toggle" aria-expanded={open} title={open ? strings.chat.switched.hide : strings.chat.switched.show} onclick={() => (open = !open)}>
      {@render line()}<span class="fold-caret" class:open aria-hidden="true"><ChevronRight size={12} /></span>
    </button>
  {:else}
    <span class="label">{@render line()}</span>
  {/if}
  <span class="rule"></span>
</div>
{#if detail}
  <div class="fold" class:open>
    <div class="inner"><p class="note" data-testid="switch-handover">{detail.text}<span class="counts">{detail.counts}</span></p></div>
  </div>
{/if}

<style>
  /* Drawn like a wake divider: a quiet line, muted words, the marks the only colour. */
  .change {
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 0;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .rule { flex: 1; min-width: 12px; height: 1px; background: var(--color-border); }
  /* Not used yet: the rule is drawn, not ruled. */
  .pending .rule { height: 0; background: none; border-top: 1px dashed var(--color-border); }
  .label {
    flex: 0 1 auto;
    min-width: 0;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 2px 6px;
    height: auto;
    min-height: var(--control-sm);
    padding: 2px 4px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    text-align: center;
  }
  button.label:hover, button.label:focus-visible { background: none; color: var(--color-foreground); }
  .side { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
  .side :global(svg), .side :global(.initial) { flex: none; }
  .lead::after { content: '·'; margin-left: 6px; color: var(--color-subtle); }
  .to { color: var(--color-foreground); }
  .arrow { display: inline-flex; color: var(--color-subtle); }
  .said { color: var(--color-subtle); }
  .said::before { content: '·'; margin-right: 6px; }
  /* A phone has no room for the change and what followed it on one row: what followed takes the next. */
  .break { display: none; flex-basis: 100%; height: 0; }
  @media (max-width: 480px) {
    .break { display: block; }
    .said.first::before { content: none; }
  }
  .fold { align-self: stretch; display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-3) var(--ease-out-quint); }
  .fold.open { grid-template-rows: 1fr; }
  .inner { min-height: 0; overflow: hidden; }
  .note {
    margin: 0 0 8px;
    padding: 8px 12px;
    border-left: 2px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }
  .counts { display: block; margin-top: 4px; color: var(--color-foreground); font-variant-numeric: tabular-nums; }
</style>
