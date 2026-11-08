<script lang="ts">
  /**
   * A setting of the model picker as its named choices side by side (effort,
   * speed, permissions): every value readable at once, one tap to change it,
   * no second menu or sheet over the picker. The arrows walk and pick like a
   * radio group; a pick leaves the picker open.
   */
  let { label, items, active, onpick, testid }: {
    label: string;
    items: { id: string; label: string; title?: string }[];
    active: string | null;
    onpick: (id: string) => void;
    testid: string;
  } = $props();

  let group = $state<HTMLDivElement | undefined>(undefined);
  /** The one the keyboard lands on: the active choice, or the first while none is. */
  let home = $derived(items.some((item) => item.id === active) ? active : items[0]?.id ?? null);

  function onkeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const here = items.findIndex((item) => item.id === (document.activeElement as HTMLElement | null)?.dataset.value);
    const next = items[(Math.max(0, here) + step + items.length) % items.length];
    if (!next) return;
    onpick(next.id);
    group?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.id)}"]`)?.focus();
  }
</script>

<div class="choices" role="radiogroup" tabindex="-1" aria-label={label} data-testid={testid} bind:this={group} {onkeydown}>
  {#each items as item (item.id)}
    <button type="button" class="choice" role="radio" aria-checked={item.id === active} tabindex={item.id === home ? 0 : -1}
      data-value={item.id} title={item.title} onclick={() => { if (item.id !== active) onpick(item.id); }}><span class="ui-label">{item.label}</span></button>
  {/each}
</div>

<style>
  /* One quiet track, the picked choice raised on it: the segmented form of the app. */
  .choices { display: flex; flex-wrap: wrap; gap: 2px; min-width: 0; padding: 2px; border-radius: var(--radius-md); background: var(--color-surface-2); }
  .choice { flex: 1 0 auto; height: var(--control-sm); padding: 0 10px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 500; box-shadow: none; }
  .choice:hover { background: var(--color-hover); color: var(--color-foreground); }
  .choice[aria-checked='true'] { background: var(--color-active); color: var(--color-foreground); font-weight: 600; }
  @media (max-width: 720px) { .choice { height: var(--touch-target); padding: 0 8px; } }
</style>
