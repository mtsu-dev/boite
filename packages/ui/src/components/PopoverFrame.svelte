<script lang="ts">
  import { Settings2, X } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { strings } from '../lib/strings';

  let { testid, heading, actions, children, actionLabel, actionTestid, keyboardAction = false, onaction, close }: {
    testid?: string;
    heading: Snippet;
    actions?: Snippet;
    children: Snippet;
    actionLabel: string;
    actionTestid?: string;
    keyboardAction?: boolean;
    onaction: () => void;
    close: () => void;
  } = $props();
</script>

<div class="popover-frame" data-testid={testid}>
  <header>
    <h2>{@render heading()}</h2>
    <div class="actions">
      {@render actions?.()}
      <button type="button" class="ghost icon" aria-label={strings.common.close} title={strings.common.close} onclick={close}><X size={17} /></button>
    </div>
  </header>
  <section class="body">{@render children()}</section>
  <div class="rule" role="separator"></div>
  <footer>
    <button type="button" class="ghost" data-testid={actionTestid} data-row={keyboardAction || undefined} onclick={onaction}><Settings2 size={15} /><span class="ui-label">{actionLabel}</span></button>
  </footer>
</div>

<style>
  .popover-frame { display: flex; flex: 1; flex-direction: column; min-height: 0; color: var(--color-foreground); background: var(--color-surface-2); }
  header, footer { flex: none; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) 10px var(--space-1) var(--space-3); }
  header { border-bottom: 1px solid var(--color-border); }
  .rule { flex: none; height: 1px; background: var(--color-border); }
  h2 { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0; font-size: var(--text-sm); font-weight: 600; }
  h2 :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .actions { flex: none; display: flex; gap: 2px; }
  .body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px var(--space-2); }
  footer button { font-size: var(--text-sm); }
</style>
