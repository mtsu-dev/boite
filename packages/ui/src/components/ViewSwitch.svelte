<script lang="ts">
  /**
   * Two views of one place, both named in sight, the one on in full ink: the
   * thread list's Projects and Recent, a phone's Bots and Contacts. A radio
   * group: a press or the arrow keys switch, the views stay separate places.
   * `size` follows the header it stands in: the desktop list's head or a
   * phone's large title.
   */
  let { options, current, onpick, label, size = 'list', testid }: {
    options: readonly { id: string; label: string; testid?: string; preload?: string }[];
    current: string;
    onpick: (id: string) => void;
    label: string;
    size?: 'list' | 'title';
    testid?: string;
  } = $props();
  let root = $state<HTMLDivElement>();

  function onkeydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const at = options.findIndex(option => option.id === current);
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = options[(at + step + options.length) % options.length]!;
    onpick(next.id);
    queueMicrotask(() => root?.querySelector<HTMLButtonElement>(`[data-value="${next.id}"]`)?.focus());
  }
</script>

<div class="view-switch {size}" role="radiogroup" aria-label={label} data-testid={testid} data-view={current} bind:this={root}>
  {#each options as option (option.id)}
    {@const on = option.id === current}
    <button type="button" class="ghost side" role="radio" aria-checked={on} tabindex={on ? 0 : -1} data-value={option.id} data-label={option.label}
      data-testid={option.testid} data-preload-view={option.preload} onclick={() => { if (!on) onpick(option.id); }} {onkeydown}><span class="ui-label">{option.label}</span></button>
  {/each}
</div>

<style>
  .view-switch { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
  /* The word is the control: no track, no fill at rest, the one on in full ink, the other a step back. */
  .side {
    flex: none; height: auto; min-height: 28px; padding: 0 6px; border-radius: var(--radius-md);
    font: inherit; letter-spacing: inherit; color: var(--color-subtle);
  }
  .side:hover:not(:disabled) { color: var(--color-muted-foreground); }
  .side[aria-checked='true'] { color: var(--color-foreground); }
  .side[aria-checked='true']:hover { background: transparent; cursor: default; }
  .side .ui-label { white-space: nowrap; }
  /* The word off also steps down in weight: in dark, ink and subtle sit close. The heading's own weight, drawn
     unseen in the same cell, keeps each word as wide on as off, so a switch moves nothing. */
  .side { display: inline-grid; align-items: center; justify-items: start; }
  .side > .ui-label, .side::after { grid-area: 1 / 1; }
  .side::after { content: attr(data-label); height: 0; overflow: hidden; visibility: hidden; white-space: nowrap; }
  .side[aria-checked='false'] > .ui-label { font-weight: 500; }
  /* The list's head: its title type; the first word on the text edge beside it. */
  .list { margin-left: -6px; }
  /* A phone's large title: the words at its size, a finger's height. */
  .title { margin: -8px 0 -8px -6px; gap: 4px; }
  .title .side { min-height: var(--touch-target); }
</style>
