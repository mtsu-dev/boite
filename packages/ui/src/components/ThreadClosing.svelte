<script lang="ts">
  /** A finished thread's last word (`lib/closing-line.ts`), under its last message. */
  let { text }: { text: string } = $props();
</script>

<p class="closing" data-testid="thread-closing"><span class="ui-label">{text}</span></p>

<style>
  /* One muted line between two hairlines, no card. */
  .closing {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 0 0;
    color: var(--color-subtle);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .closing::before, .closing::after { content: ''; flex: 1; height: 1px; background: var(--color-border); }
  .closing .ui-label { flex: none; max-width: 80%; overflow-wrap: anywhere; white-space: normal; text-align: center; }
</style>
