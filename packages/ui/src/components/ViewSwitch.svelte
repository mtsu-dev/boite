<script lang="ts">
  /**
   * Two views of one place, both named in sight: the thread list's Projects
   * and Recent, a phone's Bots and Contacts. Drawn as the app's one segmented
   * control (`.segmented` in app.css), the side on raised in its track, so it
   * reads as a switch at a glance, not as a title that happens to be pressable.
   * A radio group: a press or the arrow keys switch, the views stay separate
   * places. `size` follows the header it stands in: the desktop list's head or
   * a phone's large title.
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

<div class="segmented view-switch {size}" role="radiogroup" aria-label={label} data-testid={testid} data-view={current} bind:this={root}>
  {#each options as option (option.id)}
    {@const on = option.id === current}
    <button type="button" class="side" class:on role="radio" aria-checked={on} tabindex={on ? 0 : -1} data-value={option.id} data-label={option.label}
      data-testid={option.testid} data-preload-view={option.preload} onclick={() => { if (!on) onpick(option.id); }} {onkeydown}><span class="ui-label">{option.label}</span></button>
  {/each}
</div>

<style>
  .view-switch { min-width: 0; }
  .side { flex: none; display: inline-flex; align-items: center; justify-content: center; font-weight: 500; letter-spacing: normal; }
  .side.on { cursor: default; }
  .side .ui-label { white-space: nowrap; }
  /* The list's head: a 30 px track, its words at the meta step. */
  .list .side { height: 24px; padding: 0 9px; font-size: var(--text-sm); }
  /* A phone's large title: the words a step larger, the track a finger's height. */
  .title { padding: 3px; }
  .title .side { height: 36px; padding: 0 12px; font-size: var(--text-body); }
</style>
