<script lang="ts">
  import type { SurfaceKind } from '../lib/right-panel.svelte';
  import { strings } from '../lib/strings';
  import { offeredCards, kindName } from '../lib/surface-labels';
  import SurfaceIcon from './SurfaceIcon.svelte';

  /** The empty panel: one card per kind of surface, each with the letter that opens it. */
  let {
    available,
    onlaunch,
    onmenu,
    oncustomize
  }: {
    available: (kind: SurfaceKind) => boolean;
    onlaunch: (kind: SurfaceKind) => void;
    /** A card's right click, which offers to put it away. */
    onmenu: (event: MouseEvent, kind: SurfaceKind) => void;
    /** Where the cards come back from once every one is put away. */
    oncustomize: () => void;
  } = $props();
  // A kind this client cannot open has no card: no line under a card to say why.
  let cards = $derived(offeredCards().filter((card) => available(card.kind)));
</script>

<div class="launcher" data-testid="panel-launcher">
  <p class="section-label">{strings.rightPanel.launcher}</p>
  {#if cards.length === 0}
    <div class="none" data-testid="launcher-none">
      <p>{strings.controls.allHidden}</p>
      <button type="button" data-testid="launcher-customize" onclick={oncustomize}><span class="ui-label">{strings.controls.customize}</span></button>
    </div>
  {/if}
  <div class="cards">
    {#each cards as card (card.kind)}
      <button
        type="button"
        class="card"
        data-testid="launch-{card.kind}"
        onclick={() => onlaunch(card.kind)}
        oncontextmenu={(event) => onmenu(event, card.kind)}
      >
        <SurfaceIcon kind={card.kind} size={22} />
        <span class="card-name ui-label">{kindName(card.kind)}</span>
        <span class="kbd ui-label-box"><span class="ui-label">{card.key}</span></span>
      </button>
    {/each}
  </div>
</div>

<style>
  /* The empty panel lists what it can open: compact tiles of one size at its top, as many to a row as its width holds.
     A tile never stretches with the panel: wide or tall, the panel only leaves more room around them. */
  .launcher {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }

  .none {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }

  /* Three tiles to a row at the panel's default width, two at its narrowest. */
  .cards {
    flex: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--tile-width));
    grid-auto-rows: var(--tile-height);
    gap: var(--space-2);
    --tile-width: 116px;
    --tile-height: 84px;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    width: var(--tile-width);
    height: var(--tile-height);
    padding: var(--space-3) var(--space-2) var(--space-2);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    text-align: center;
    white-space: normal;
    transition: border-color var(--dur-2) var(--ease-out-quint), background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint);
  }

  .card:hover:not(:disabled) {
    border-color: var(--color-edge);
    background: var(--color-surface-3);
    color: var(--color-foreground);
  }

  .card-name {
    color: var(--color-foreground);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  /* The letter that opens it, quiet in the corner until the tile is pointed at. */
  .card .kbd {
    position: absolute;
    top: 6px;
    right: 6px;
    opacity: .6;
    transition: opacity var(--dur-2) var(--ease-out-quint);
  }
  .card:hover .kbd, .card:focus-visible .kbd { opacity: 1; }

  /* A phone has no keyboard to press the letter with, and three tiles share its width evenly. */
  @media (max-width: 720px) {
    .card .kbd { display: none; }
    .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .card { width: auto; }
  }
</style>
