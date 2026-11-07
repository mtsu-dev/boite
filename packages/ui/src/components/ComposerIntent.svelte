<script lang="ts">
  import { Pencil, X } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * One quiet line above the box while Send replaces a sent message, with the
   * way out on its right. A question the box answers says so in its own card.
   */
  let { editing, oncancel }: { editing: boolean; oncancel: () => void } = $props();
</script>

{#if editing}
  <div class="intent" data-testid="composer-editing">
    <Pencil size={13} />
    <span class="ui-label">{strings.composer.editing}</span>
    <button type="button" class="ghost small icon" data-testid="composer-editing-cancel" title={strings.composer.editingCancel} aria-label={strings.composer.editingCancel} onclick={oncancel}><X size={13} /></button>
  </div>
{/if}

<style>
  .intent {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 0 14px;
    color: var(--color-foreground);
    font-size: var(--text-xs);
  }
  .intent span { flex: 1; min-width: 0; }
</style>
