<script lang="ts" module>
  import type { Component } from 'svelte';
  /** One permission mode: its word, the plain line under it and the long sentence on hover. */
  export interface ModeChoice { id: string; label: string; hint: string; title: string; icon: Component<{ size?: number; strokeWidth?: number }> }
</script>

<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import { clearOfDecision } from '../lib/clear-of-decision';
  import { strings } from '../lib/strings';
  import SheetHead from './SheetHead.svelte';

  /**
   * The composer's permission chip: the mode's icon and word at rest, the same
   * word on every agent, desktop and phone, at 360 px too. It opens one list: each mode a full row with its icon,
   * its word, one plain line saying what the agent then does, and a check on
   * the live one. A popover on desktop, the shared bottom sheet on a phone.
   * `readonly` names a bot's mode, set in its settings: it opens nothing.
   */
  let { items, active, onpick, disabled = false, readonly = false, readonlyHint = '' }: {
    items: ModeChoice[];
    active: string;
    onpick: (id: string) => void;
    disabled?: boolean;
    readonly?: boolean;
    readonlyHint?: string;
  } = $props();

  const popover = new Closing();
  let root = $state<HTMLDivElement | undefined>(undefined);
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
  let list = $state<HTMLDivElement | undefined>(undefined);
  let current = $derived(items.find((item) => item.id === active) ?? null);
  let Glyph = $derived(current?.icon);
  let name = $derived(current ? `${strings.composer.mode}: ${current.label}` : strings.composer.mode);

  function rows(): HTMLButtonElement[] {
    return list ? [...list.querySelectorAll<HTMLButtonElement>('[data-row]:not(:disabled)')] : [];
  }

  async function open() {
    popover.show();
    await tick();
    // The keyboard lands on the live mode, so Enter keeps it and the arrows move from it.
    (list?.querySelector<HTMLButtonElement>('[aria-checked=true]') ?? rows()[0])?.focus({ preventScroll: true });
  }

  function close() {
    popover.hide();
    trigger?.focus({ preventScroll: true });
  }

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    if (disabled) return;
    if (popover.open) close(); else void open();
  }

  function pick(id: string) {
    close();
    if (id !== active) onpick(id);
  }

  function onkeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Escape') {
      if (!popover.open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!popover.open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); void open(); }
      return;
    }
    const all = rows();
    if (all.length === 0) return;
    const here = all.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (here + 1) % all.length;
    else if (event.key === 'ArrowUp') next = (here - 1 + all.length) % all.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = all.length - 1;
    else return;
    event.preventDefault();
    all[next]?.focus({ preventScroll: true });
  }

  /** A press, not a click: another chip's trigger stops its click from bubbling here. */
  function outside(event: PointerEvent) {
    if (!popover.open) return;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    popover.hide();
  }
</script>

<svelte:window onpointerdown={outside} />

<div class="permission" bind:this={root}>
  {#if readonly}
    <span class="ui-chip trigger readonly" data-testid="composer-mode" title={readonlyHint || name} aria-label={readonlyHint || name}>
      {#if Glyph}<Glyph size={14} strokeWidth={1.75} />{/if}
      <span class="ui-label word" data-testid="composer-mode-value">{current?.label ?? ''}</span>
    </span>
  {:else}
    <button type="button" class="ui-chip trigger" aria-haspopup="menu" aria-expanded={popover.open} aria-label={name} title={current?.title ?? strings.composer.mode} data-testid="composer-mode" {disabled} bind:this={trigger} onclick={toggle} {onkeydown}>
      {#if Glyph}<Glyph size={14} strokeWidth={1.75} />{/if}
      <span class="ui-label word" data-testid="composer-mode-value">{current?.label ?? ''}</span>
      <!-- The chevron the model chip has: all three read as controls that open. -->
      <ChevronDown size={12} strokeWidth={2} class="chevron" />
    </button>
  {/if}

  {#if popover.shown}
    <div class="popover" class:closing={popover.closing} role="menu" tabindex="-1" aria-label={strings.composer.mode} data-testid="composer-mode-menu" bind:this={list} {onkeydown}
      use:popover.attach use:floating={{ anchor: () => clearOfDecision(trigger, list), placement: 'top', dismiss: () => popover.hide() }} onanimationend={popover.end}>
      <SheetHead title={strings.composer.mode} />
      {#each items as item (item.id)}
        <button type="button" class="row" role="menuitemradio" aria-checked={item.id === active} data-row data-value={item.id} title={item.title} onclick={() => pick(item.id)}>
          <span class="glyph"><item.icon size={16} strokeWidth={1.75} /></span>
          <span class="text"><span class="label ui-label">{item.label}</span><span class="hint">{item.hint}</span></span>
          <span class="mark" aria-hidden="true">{#if item.id === active}<Check size={14} strokeWidth={2} />{/if}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .permission { position: relative; display: inline-flex; min-width: 0; }
  .trigger { cursor: pointer; height: var(--control-sm); }
  .trigger.readonly { cursor: default; }
  .trigger[aria-expanded='true'] { background: var(--control-glaze) var(--color-control-hover); color: var(--color-foreground); }
  @media (hover: hover) { .trigger:not(.readonly):hover { background: var(--control-glaze) var(--color-control-hover); color: var(--color-foreground); } }
  /* Every menu's one edge, radius and shadow; rows at the app menus' height and inset. */
  .popover { display: flex; flex-direction: column; gap: 2px; width: min(340px, calc(100vw - 24px)); padding: var(--space-1); color: var(--color-foreground); background: var(--overlay-surface); border: 1px solid var(--overlay-edge); border-radius: var(--radius-overlay); box-shadow: var(--shadow-overlay); overflow-y: auto; animation: pop var(--dur-2) var(--ease-out-quint); }
  .popover.closing { animation-name: pop-out; pointer-events: none; }
  .row { display: flex; align-items: center; justify-content: flex-start; gap: var(--space-3); width: 100%; height: auto; min-height: 48px; padding: var(--space-2) var(--overlay-row-pad, 10px); border: none; border-radius: var(--radius-sm); background: transparent; color: var(--color-foreground); font-size: var(--text-body); font-weight: 400; text-align: left; white-space: normal; }
  .row:hover, .row:focus-visible { background: var(--color-hover); }
  .row[aria-checked='true'] { background: var(--color-hover); }
  .glyph { display: inline-flex; flex: none; color: var(--color-muted-foreground); }
  .row[aria-checked='true'] .glyph { color: var(--color-foreground); }
  .text { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
  /* The word is the row's name; the line under it is lighter and smaller, so the eye lands on the word first. */
  .label { font-weight: 600; }
  .hint { color: var(--color-muted-foreground); font-size: var(--text-meta, var(--text-xs)); line-height: 1.35; }
  .mark { display: inline-flex; flex: 0 0 14px; }
  /* The live mode's check is the one accent of the list. */
  .mark :global(svg) { color: var(--color-accent); }

  @media (max-width: 720px) {
    .trigger { height: var(--touch-target); padding: 0 6px; }
    .popover { gap: var(--space-1); padding: var(--space-2); }
    .row { min-height: 56px; gap: var(--space-4); padding-inline: var(--space-3); font-size: var(--text-base); }
    .hint { font-size: var(--text-sm); }
    .mark { flex-basis: 16px; }
  }
</style>
