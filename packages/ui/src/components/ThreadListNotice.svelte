<script lang="ts">
  import { fill, strings } from '../lib/strings';
  import { machineName, type Machine } from '../lib/workspace.svelte';

  let { machines }: { machines: readonly Machine[] } = $props();
</script>

{#each machines as machine (machine.id)}
  {@const issue = machine.store.threadListIssue}
  {#if issue && machine.store.connection === 'ready'}
    {@const name = machineName(machine)}
    <div class="thread-list-notice" data-testid="thread-list-notice">
      <span class="ui-label" role="status">{fill(issue === 'failed' ? strings.sidebar.threadListFailed : strings.sidebar.threadListRetrying, { machine: name })}</span>
      {#if issue === 'failed'}
        <button type="button" class="ghost" data-testid="thread-list-retry" onclick={() => void machine.store.retryThreadList()}>{strings.common.retry}</button>
      {/if}
    </div>
  {/if}
{/each}

<style>
  .thread-list-notice { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-1) var(--space-2); margin: var(--space-2) 0; padding: var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-foreground); font-size: var(--text-xs); overflow-wrap: anywhere; }
  button { min-height: var(--control-sm); }
  @media (max-width: 720px) { button { min-height: var(--touch-target); } }
</style>
