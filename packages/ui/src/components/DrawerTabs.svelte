<script lang="ts">
  import { SquareKanban, SquareTerminal } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * The two tabs at the start of the drawer under the chat: the project's
   * board and the thread's terminal. A paired device runs no shell, so it
   * shows the board alone. Their names and icons are the panel selector's
   * (`lib/panel-choices.ts`), so a drawer reads as the row that opened it.
   */
  let { store, current }: { store: Store; current: 'board' | 'terminal' } = $props();
</script>

<div class="tabs" role="tablist" aria-label={strings.board.tabs} data-testid="drawer-tabs">
  <button type="button" class="ghost tab ui-label" role="tab" aria-selected={current === 'board'} class:selected={current === 'board'}
    data-testid="drawer-tab-board" onclick={() => { if (current !== 'board') store.showBoard(); }}>
    <SquareKanban size={14} aria-hidden="true" />{strings.board.open}
  </button>
  {#if store.owner}
    <button type="button" class="ghost tab ui-label" role="tab" aria-selected={current === 'terminal'} class:selected={current === 'terminal'}
      data-testid="drawer-tab-terminal" onclick={() => { if (current !== 'terminal') store.toggleTerminal(); }}>
      <SquareTerminal size={14} aria-hidden="true" />{strings.terminal.title}
    </button>
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    margin-left: -6px;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--control-sm);
    padding: 0 8px;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-muted-foreground);
    background: none;
    white-space: nowrap;
  }

  .tab:not(.selected):hover { background: var(--color-hover); color: var(--color-foreground); }
  .tab.selected { background: var(--color-active); color: var(--color-foreground); }
</style>
