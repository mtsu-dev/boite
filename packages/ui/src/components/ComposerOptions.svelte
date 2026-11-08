<script lang="ts" module>
  import type { Component } from 'svelte';
  /** One permission mode: its word, the plain line under it and the long sentence on hover. */
  export interface ModeChoice { id: string; label: string; hint: string; title: string; icon: Component<{ size?: number; strokeWidth?: number }> }
</script>

<script lang="ts">
  // The composer's one "+": every way to add to the message (files, a file
  // mention, a command), the context's details and the draft's worktree
  // switch, on both widths. A phone has no room for the permission chip at
  // 360 px, so it comes first here with its value and opens its modes in place.
  import { AtSign, ChartPie, Check, ChevronRight, GitBranch, Paperclip, Plus, SquareSlash } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import { strings } from '../lib/strings';
  import BackRow from './BackRow.svelte';

  let { worktree, canAttach, anchor, onattach, onworktree, onmention, oncommand, context = null, oncontext, mode = null }: {
    /** The draft's worktree switch, or null where a thread keeps its folder. */
    worktree: boolean | null;
    canAttach: boolean;
    /** What the menu opens above: the "+", or the whole composer while an ask is docked in it. */
    anchor?: () => HTMLElement | null;
    onattach: () => void;
    onworktree: () => void;
    onmention?: () => void;
    oncommand?: () => void;
    /** The context row's words ("Context 59% used"), or null where no thread holds one. */
    context?: string | null;
    oncontext?: () => void;
    /** The permission row on a phone, or null where the chip shows it. */
    mode?: { active: string; items: ModeChoice[]; onpick: (id: string) => void } | null;
  } = $props();
  const panel = new Closing();
  let trigger = $state<HTMLButtonElement>();
  let content = $state<HTMLDivElement>();
  /** The modes listed in place of the rows, behind one back row. */
  let modes = $state(false);
  let current = $derived(mode?.items.find((item) => item.id === mode?.active) ?? null);
  let empty = $derived(!canAttach && !onmention && !oncommand && worktree === null && context === null && mode === null);
  function close() { panel.hide(); trigger?.focus({ preventScroll: true }); }
  async function focusFirst(selector = 'button') {
    await tick();
    // Closed before the rows drew: the focus stays where the close put it.
    if (!panel.open) return;
    content?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
  }
  async function open(level = false) {
    modes = level && mode !== null;
    panel.show();
    await focusFirst(modes ? '[aria-checked=true]' : 'button');
  }
  /** A slash command or a test reaches the modes straight away. */
  export function openModes() { void open(true); }
  function run(action: () => void) { panel.hide(); action(); }
  function showModes(next: boolean) {
    modes = next;
    void focusFirst(next ? '[aria-checked=true]' : '[data-testid=composer-mode]');
  }
  function keydown(event: KeyboardEvent) {
    if (!panel.open || !content) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      // The second level steps back first, as every back row does.
      if (modes) showModes(false); else close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = [...content.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const here = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(here + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
  }
  function outside(event: PointerEvent) {
    if (!panel.open || !(event.target instanceof Node)) return;
    if (trigger?.contains(event.target) || content?.contains(event.target)) return;
    panel.hide();
  }
</script>

<svelte:window onpointerdown={outside} />

{#if !empty}
<div class="options">
  <button class="icon ghost opener" bind:this={trigger} data-testid="composer-options" aria-label={strings.composer.options} title={strings.composer.options} aria-haspopup="menu" aria-expanded={panel.open} onclick={() => panel.open ? close() : void open()}><Plus size={18} strokeWidth={1.75} /></button>
  {#if panel.shown}
    <div class="options-menu" class:closing={panel.closing} bind:this={content} role="menu" tabindex="-1" aria-label={modes ? strings.composer.mode : strings.composer.options} data-testid="composer-options-sheet" onkeydown={keydown}
      use:panel.attach onanimationend={panel.end} use:floating={{ anchor: () => anchor?.() ?? trigger ?? null, placement: 'top', sheet: anchor?.() ? false : undefined, dismiss: close }}>
      {#if modes && mode}
        <div class="modes" role="group" aria-label={strings.composer.mode} data-testid="composer-mode-menu">
          <BackRow label={strings.composer.mode} data-testid="composer-mode-back" onclick={() => showModes(false)} />
          {#each mode.items as item (item.id)}
            <button class="row choice" role="menuitemradio" aria-checked={item.id === mode.active} data-row data-value={item.id} title={item.title} onclick={() => run(() => mode.onpick(item.id))}>
              <item.icon size={16} strokeWidth={1.75} />
              <span class="text"><span class="label ui-label">{item.label}</span><span class="hint">{item.hint}</span></span>
              <span class="mark" aria-hidden="true">{#if item.id === mode.active}<Check size={16} strokeWidth={2} />{/if}</span>
            </button>
          {/each}
        </div>
      {:else}
      {#if mode && current}
        <!-- The mode reads at rest here: its name, its word at the end, its modes one tap away. -->
        <button class="row value-row" role="menuitem" aria-haspopup="menu" data-testid="composer-mode" onclick={() => showModes(true)}>
          <current.icon size={16} strokeWidth={1.75} /><span class="ui-label name">{strings.composer.mode}</span>
          <span class="value ui-label" data-testid="composer-mode-value">{current.label}</span><ChevronRight size={16} strokeWidth={1.75} />
        </button>
      {/if}
      {#if canAttach}
        <button class="row" role="menuitem" data-testid="composer-attach" onclick={() => run(onattach)}><Paperclip size={16} strokeWidth={1.75} /><span class="ui-label">{strings.composer.attach}</span></button>
      {/if}
      {#if onmention}
        <button class="row" role="menuitem" data-testid="composer-mention" onclick={() => run(onmention)}><AtSign size={16} strokeWidth={1.75} /><span class="ui-label">{strings.composer.mentionFile}</span></button>
      {/if}
      {#if oncommand}
        <button class="row" role="menuitem" data-testid="composer-commands" onclick={() => run(oncommand)}><SquareSlash size={16} strokeWidth={1.75} /><span class="ui-label">{strings.composer.commands}</span></button>
      {/if}
      {#if context !== null && oncontext}
        <button class="row" role="menuitem" data-testid="composer-context" onclick={() => run(oncontext)}><ChartPie size={16} strokeWidth={1.75} /><span class="ui-label">{context}</span></button>
      {/if}
      {#if worktree !== null}
        <button class="row worktree" role="menuitemcheckbox" aria-checked={worktree} data-testid="composer-worktree" title={worktree ? strings.composer.worktreeOn : strings.composer.worktreeOff} onclick={onworktree}><GitBranch size={16} strokeWidth={1.75} /><span class="ui-label">{strings.composer.worktree}</span><span class="switch" class:on={worktree}></span></button>
      {/if}
      {/if}
    </div>
  {/if}
</div>
{/if}

<style>
  .options { display: flex; flex: none; }
  .opener { width: var(--control); height: var(--control); border-radius: var(--radius-full); color: var(--color-muted-foreground); }
  .opener:hover, .opener[aria-expanded='true'] { color: var(--color-foreground); }
  /* Every menu's one edge, radius and shadow. */
  .options-menu { min-width: 220px; padding: 6px; color: var(--color-foreground); background: var(--overlay-surface); border: 1px solid var(--overlay-edge); border-radius: var(--radius-overlay); box-shadow: var(--shadow-overlay); overflow-y: auto; animation: pop var(--dur-2) var(--ease-out-quint); }
  .options-menu.closing { animation-name: pop-out; pointer-events: none; }
  .modes { display: flex; flex-direction: column; gap: 1px; }
  .row { display: flex; align-items: center; justify-content: flex-start; gap: 10px; width: 100%; min-height: var(--row); padding: 4px 10px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--color-foreground); font-size: var(--text-sm); text-align: left; }
  .row :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .row:hover, .row:focus-visible { background: var(--color-hover); }
  .worktree .ui-label, .value-row .name { flex: 1; }
  .value-row .value { min-width: 0; color: var(--color-muted-foreground); white-space: nowrap; }
  .choice { padding-block: 6px; }
  .choice .text { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
  .choice .hint { color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.3; }
  .choice .mark { display: inline-flex; flex: 0 0 16px; }
  /* The live mode's check is the one accent of the list. */
  .choice .mark :global(svg) { color: var(--color-accent); }
  /* The shared switch (app.css), at the size of the row's text. */
  .switch { --switch-width: 28px; --switch-height: 16px; }

  @media (max-width: 720px) {
    .opener { width: var(--touch-target); height: var(--touch-target); }
    .options-menu { padding: 8px; }
    .row { min-height: var(--touch-target); gap: 12px; font-size: var(--text-base); }
    .choice .hint { font-size: var(--text-sm); }
  }
</style>
