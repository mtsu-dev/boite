<script lang="ts">
  import { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import { fitMenu } from '../lib/menu-fit';
  import type { PaletteItem } from '../lib/palette';

  /**
   * The list that pops over the composer: the slash menu and the mention menu
   * are the same box with different rows. The composer owns the query, the
   * selection and the keyboard; this only draws, and closes the way the
   * picker does. Each row is the label in mono, a hint greyed beside it, the
   * description under it, and a heading where the caller says the group changes.
   */
  let {
    open,
    items,
    selected,
    kind,
    label,
    empty,
    footer = null,
    heading = () => null,
    nameOf = (item) => item.label,
    onpick,
    onhover
  }: {
    open: boolean;
    items: PaletteItem[];
    /** The row the keyboard is on, an index into `items`. */
    selected: number;
    /** The test ids: `<kind>-menu`, `<kind>-row`, `<kind>-empty`. */
    kind: 'slash' | 'mention';
    /** The list's accessible name. */
    label: string;
    /** What the box says when nothing matches. */
    empty: string;
    /** One line under the rows, for what the list left out. */
    footer?: string | null;
    /** The heading before a row, only where the group changes. */
    heading?: (index: number) => string | null;
    /** What a row's `data-name` says, the thing a test picks it by. */
    nameOf?: (item: PaletteItem) => string;
    onpick: (item: PaletteItem) => void;
    onhover: (index: number) => void;
  } = $props();

  const popover = new Closing();
  let list = $state<HTMLDivElement | undefined>(undefined);

  $effect(() => {
    if (open) popover.show();
    else popover.hide();
  });

  $effect(() => {
    void items;
    const row = list?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    // jsdom draws nothing and has no scrollIntoView; a real list keeps the row in view.
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  });
</script>

{#if popover.shown}
  <div
    class="menu"
    class:closing={popover.closing}
    role="listbox"
    aria-label={label}
    tabindex="-1"
    data-testid="{kind}-menu"
    bind:this={list}
    use:popover.attach
    use:floating={{ anchor: () => list?.closest<HTMLElement>('[data-testid=composer]') ?? list?.parentElement ?? null, placement: 'top', sheet: false, matchWidth: true, cap: 420, fit: fitMenu }}
    onanimationend={popover.end}
  >
    {#each items as item, index (item.id)}
      {@const title = heading(index)}
      {#if title}
        <div class="section-label">{title}</div>
      {/if}
      <button
        type="button"
        class="row"
        class:selected={index === selected}
        role="option"
        aria-selected={index === selected}
        data-index={index}
        data-testid="{kind}-row"
        data-name={nameOf(item)}
        onmousemove={() => onhover(index)}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => onpick(item)}
      >
        <span class="head">
          <span class="name">{item.label}</span>
          {#if item.hint}
            <span class="hint">{item.hint}</span>
          {/if}
        </span>
        {#if item.description}
          <span class="description ui-label">{item.description}</span>
        {/if}
      </button>
    {/each}
    {#if items.length === 0}
      <p class="empty subtle" data-testid="{kind}-empty">{empty}</p>
    {:else if footer}
      <p class="footer subtle" data-testid="{kind}-footer">{footer}</p>
    {/if}
  </div>
{/if}

<style>
  /* Above the composer, in the overlay card every menu wears (app.css), with
     the same entrance. Eight rows fit, the rest scrolls; a shorter
     window gets a shorter list, or the list under the box when that side has
     more room (`lib/menu-fit.ts`). */
  .menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: min(420px, 100%);
    overflow: auto;
    padding: var(--overlay-pad);
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    animation: pop var(--dur-2) var(--ease-out-quint);
    transform-origin: bottom left;
  }

  .menu.closing {
    animation-name: pop-out;
    pointer-events: none;
  }

  /* The overlay's head form, as Menu's headings. */
  .section-label {
    padding: var(--space-2) var(--overlay-row-pad) var(--space-1);
    color: var(--color-subtle);
  }

  .row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 1px;
    width: 100%;
    height: auto;
    min-height: var(--overlay-row);
    flex: none;
    padding: var(--space-1) var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
    white-space: normal;
  }

  .row:hover:not(:disabled) {
    background: var(--color-hover);
  }

  .row.selected {
    background: var(--color-active);
  }

  /* A full width row does not shrink under the finger. */
  .row:active:not(:disabled) {
    transform: none;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
  }

  .name {
    font-size: var(--text-base);
    font-weight: 500;
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* What sits after the name is read, never inserted. */
  .hint {
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--color-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .description {
    max-width: 100%;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty,
  .footer {
    padding: var(--space-2) var(--overlay-row-pad);
    font-size: var(--text-sm);
  }

  .footer {
    font-size: var(--text-xs);
  }
</style>
