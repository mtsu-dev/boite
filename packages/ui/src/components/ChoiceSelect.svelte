<script lang="ts" generics="T extends string">
  // One choice that is seen before it is picked (a palette, a text face, a code
  // face): the value in use as one row with its preview, which opens the others,
  // each with its own. A face needs no picture: its name is drawn in it. A popover on a desktop, a bottom sheet on a phone
  // (lib/floating.ts), so the two read the same. `row`: a phone's label and value
  // row, the value and a chevron at its end, the whole row its target (the row
  // it sits in is `position: relative`).
  import { tick, type Snippet } from 'svelte';
  import { Check, ChevronDown, ChevronRight, LayoutGrid } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { curated } from '../lib/curated';
  import { floating } from '../lib/floating';

  let { label, options, value, fallback = '', onpick, preview, testid, optionTestid, face, front, all, row = false }: {
    /** What is chosen: the list's name and the sheet's title. */
    label: string;
    /** `disabled`: an option that cannot be picked now (a policy, a running install), still listed. */
    options: { id: T; name: string; disabled?: boolean }[];
    /** The option in use; none when the value matches no option (edited colours). */
    value: T | undefined;
    /** The trigger's words when no option matches. */
    fallback?: string;
    onpick: (id: T) => void;
    /** An option's picture, drawn by the caller in the trigger and in the list; none when the name is enough (a face). */
    preview?: Snippet<[T | undefined]>;
    testid: string;
    optionTestid: (id: T) => string;
    /** The font an option's name is drawn in, so a face reads as itself. */
    face?: (id: T) => string;
    /** How many options the list shows before `all` opens the rest: the one in use and the first others. */
    front?: number;
    /** The row that opens the rest. */
    all?: string;
    /** The value at the end of its row, which it covers: no chip, a chevron to the side. */
    row?: boolean;
  } = $props();

  const popover = new Closing();
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let sheet = $state(false);
  let shown = $derived(options.find((option) => option.id === value));
  let everything = $state(false);
  let listed = $derived(everything || !front ? options : curated(options, value, front));

  // The keys land on the option in use; a phone sheet holds the focus itself, as a menu's does.
  $effect(() => {
    if (!popover.open) { sheet = false; everything = false; return; }
    void tick().then(() => {
      const list = root?.querySelector<HTMLElement>('[role=menu]');
      sheet = !!list?.dataset['mobileSheet'];
      if (sheet) list?.focus({ preventScroll: true });
      else (rows().find((row) => row.getAttribute('aria-checked') === 'true') ?? rows()[0])?.focus({ preventScroll: true });
    });
  });

  function rows(): HTMLElement[] {
    return root ? [...root.querySelectorAll<HTMLElement>('[role=menuitemradio], [role=menuitem]')] : [];
  }

  /** The rest of the list opens where "All" stood, the first of them in focus. */
  function openAll() {
    const at = listed.length;
    everything = true;
    void tick().then(() => rows().filter((row) => row.getAttribute('role') === 'menuitemradio')[at]?.focus({ preventScroll: true }));
  }

  function pick(id: T) {
    popover.hide();
    trigger?.focus({ preventScroll: true });
    onpick(id);
  }

  function onWindowPointerdown(event: PointerEvent) {
    if (!popover.open || (root && event.target instanceof Node && root.contains(event.target))) return;
    popover.hide();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && popover.open) {
      event.stopPropagation();
      popover.hide();
      trigger?.focus({ preventScroll: true });
      return;
    }
    if (!popover.open) {
      if (event.key === 'ArrowDown') { event.preventDefault(); popover.show(); }
      return;
    }
    const list = rows();
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    if (next < 0) return;
    event.preventDefault();
    list[next]?.focus({ preventScroll: true });
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

<div class="choice-select" class:row bind:this={root}>
  <button type="button" class="trigger" class:bare={!preview} aria-haspopup="menu" aria-expanded={popover.open} aria-label="{label}: {shown?.name ?? fallback}"
    data-testid={testid} bind:this={trigger} onclick={(event) => { event.stopPropagation(); popover.toggle(); }} {onkeydown}>
    {#if preview}<span class="preview" aria-hidden="true">{@render preview(value)}</span>{/if}
    <span class="name ui-label" style:font-family={shown && face ? face(shown.id) : undefined}>{shown?.name ?? fallback}</span>
    {#if row}<ChevronRight size={16} strokeWidth={1.75} />{:else}<ChevronDown size={14} strokeWidth={1.75} />{/if}
  </button>
  {#if popover.shown}
    <div class="list" class:closing={popover.closing} role="menu" tabindex="-1" aria-label={label} {onkeydown}
      use:popover.attach onanimationend={popover.end}
      use:floating={{ anchor: () => trigger ?? null, placement: 'bottom', align: 'end', cap: 480, dismiss: () => popover.hide() }}
      data-testid="{testid}-list">
      {#if sheet}<div class="sheet-title" aria-hidden="true">{label}</div>{/if}
      {#each listed as option (option.id)}
        <button type="button" class="option" role="menuitemradio" aria-checked={option.id === value} data-testid={optionTestid(option.id)} disabled={option.disabled} onclick={() => pick(option.id)}>
          {#if preview}<span class="preview" aria-hidden="true">{@render preview(option.id)}</span>{/if}
          <span class="name ui-label" style:font-family={face?.(option.id)}>{option.name}</span>
          <span class="check" aria-hidden="true">{#if option.id === value}<Check size={14} strokeWidth={2} />{/if}</span>
        </button>
      {/each}
      {#if all && listed.length < options.length}
        <button type="button" class="option all" role="menuitem" aria-expanded="false" data-testid="{testid}-all" onclick={(event) => { event.stopPropagation(); openAll(); }}>
          <span class="preview all-mark" aria-hidden="true"><LayoutGrid size={16} strokeWidth={1.75} /></span>
          <span class="name ui-label">{all}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .choice-select { display: inline-flex; min-width: 0; max-width: 100%; }
  /* The value in use, raised like a chip: its picture, its name, the chevron that opens the rest. */
  .trigger { display: inline-flex; align-items: center; gap: var(--space-3); min-width: 0; max-width: 100%; height: auto; min-height: var(--control); padding: var(--space-1) var(--space-3) var(--space-1) var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-2); color: var(--color-foreground); font-size: var(--text-sm); font-weight: 400; text-align: left; }
  @media (hover: hover) { .trigger:hover:not(:disabled) { background: var(--color-surface-3); border-color: var(--color-edge); } }
  .trigger.bare { padding-left: var(--space-3); }
  .trigger[aria-expanded='true'] { background: var(--color-surface-3); border-color: var(--color-edge); }
  .trigger > :global(svg) { flex: none; color: var(--color-muted-foreground); transition: transform var(--dur-2) var(--ease-out-quint); }
  .trigger[aria-expanded='true'] > :global(svg) { transform: rotate(180deg); }
  .preview { display: inline-flex; flex: none; align-items: center; }
  .preview:empty { display: none; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trigger .name { flex: 1; }
  .list { display: flex; flex-direction: column; gap: 1px; min-width: 260px; max-width: 360px; padding: var(--overlay-pad); overflow-y: auto; background: var(--overlay-surface); border: 1px solid var(--overlay-edge); border-radius: var(--radius-overlay); box-shadow: var(--shadow-overlay); font-size: var(--text-base); z-index: 40; animation: pop var(--motion-duration) var(--motion-curve); }
  .list.closing { animation: pop-out var(--motion-duration) var(--motion-curve); pointer-events: none; }
  .list:focus { outline: none; }
  .list > * { flex: none; }
  .sheet-title { padding: 0 var(--space-4) var(--space-3); color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 600; text-align: center; }
  .option { display: flex; align-items: center; gap: var(--space-3); width: 100%; height: auto; min-height: var(--overlay-row); padding: var(--space-1) var(--overlay-row-pad); border: 0; border-radius: var(--radius-overlay-row); background: transparent; color: var(--color-foreground); font-weight: 400; text-align: left; }
  @media (hover: hover) { .option:hover { background: var(--color-hover); } }
  .option:active { transform: none; background: var(--color-active); }
  .option .name { flex: 1; }
  .check { display: inline-flex; flex: none; width: 14px; }
  .all { color: var(--color-muted-foreground); }
  .all-mark { justify-content: center; width: 52px; }
  /* A row's value: quiet words at the row's end, the row the target (::after spans it). */
  .row .trigger, .row .trigger[aria-expanded='true'] { position: static; justify-content: flex-end; gap: var(--space-2); min-height: 0; padding: 0; border: 0; background: transparent; box-shadow: none; color: var(--color-muted-foreground); font-size: var(--text-base); }
  .row .trigger::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
  .row .trigger:active:not(:disabled) { transform: none; }
  .row .trigger:focus-visible { outline: none; }
  .row .trigger:focus-visible::after { outline: var(--focus-ring); outline-offset: -2px; }
  .row .trigger .name { flex: 0 1 auto; }
  .row .trigger > :global(svg) { color: var(--color-subtle); }
  .row .trigger[aria-expanded='true'] > :global(svg) { transform: none; }
  @media (max-width: 720px) {
    .choice-select:not(.row), .choice-select:not(.row) .trigger { width: 100%; }
    .choice-select:not(.row) .trigger { min-height: var(--touch-target); }
    .option { min-height: var(--touch-target); padding-inline: var(--space-4); }
  }
</style>
