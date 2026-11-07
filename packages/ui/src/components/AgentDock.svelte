<script lang="ts">
  import { threadBusy } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import StatusMark from './StatusMark.svelte';
  import { threadTone, workflowTone } from '../lib/thread-state';
  import Elapsed from './Elapsed.svelte';
  import { upkeepOf } from '../lib/agent-upkeep';

  let { store, threadId }: { store: Store; threadId: string } = $props();
  /**
   * Every subagent and workflow at work for this thread keeps its own entry in
   * the strip above the composer, by name, with its state and its time: a click
   * opens its panel. At work in a turn, or waiting on its own background work:
   * either way its result has not come back. A persistent agent's memory pass is
   * the core's upkeep, not a subagent it sent.
   */
  let active = $derived((store.delegation?.agents ?? []).filter(agent => threadBusy(agent.thread) && !upkeepOf(store).has(agent.thread.id)));
  let native = $derived((store.delegation?.nativeAgents ?? []).filter(agent => agent.status === 'running'));
  let runs = $derived(store.workflowsOf(threadId).filter(run => run.status === 'running'));

  $effect(() => { void store.loadDelegation(threadId); });
  $effect(() => { void store.loadWorkflows(threadId); });

  function openAgent(id: string): void {
    store.showTeam();
    void store.selectDelegatedAgent(id);
  }
</script>

{#snippet entry(name: string, startedAt: number, kind: string, open: () => void, workflow = false)}
  <button type="button" class="entry" data-testid="active-subagent" data-kind={kind} title={name} onclick={open}>
    <StatusMark {...workflow ? workflowTone('running', true) : threadTone('running')} />
    <span class="name ui-label">{name}</span>
    <Elapsed {startedAt} finishedAt={null} active />
  </button>
{/snippet}

{#if active.length > 0 || native.length > 0 || runs.length > 0}
  <div class="dock" data-testid="agent-dock">
    <div class="entries" role="group" data-testid="active-subagents" data-count={active.length + native.length} data-runs={runs.length}>
      {#each active as agent (agent.thread.id)}
        {@render entry(agent.thread.title, agent.lastTurn?.startedAt ?? agent.lastTurn?.queuedAt ?? agent.thread.createdAt, 'agent', () => openAgent(agent.thread.id))}
      {/each}
      {#each native as agent (agent.id)}
        {@render entry(agent.name ?? agent.task ?? agent.id, agent.startedAt, 'native', () => store.showTeam())}
      {/each}
      {#each runs as run (run.id)}
        {@render entry(run.name, run.createdAt, 'workflow', () => store.panel.openWorkflow(run.id), true)}
      {/each}
    </div>
  </div>
{/if}

<style>
  .dock { display: contents; }
  .entries { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .entry { min-width: 0; max-width: min(240px, 100%); height: 30px; gap: 6px; padding: 0 10px; border: 1px solid var(--color-edge); border-radius: var(--radius-lg); background: var(--color-surface-2); color: var(--color-foreground); font-size: var(--text-sm); font-weight: 550; }
  .entry:hover { background: var(--color-surface-3); }
  /* A phone keeps them on one row that scrolls sideways, each entry whole. */
  @media (max-width: 720px) {
    .entries { flex: 1 1 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .entry { flex: none; }
  }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry :global(.elapsed) { flex: none; color: var(--color-muted-foreground); font-weight: 400; font-variant-numeric: tabular-nums; }
</style>
