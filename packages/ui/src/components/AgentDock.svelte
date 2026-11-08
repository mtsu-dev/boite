<script lang="ts">
  import type { Store } from '../lib/store.svelte';
  import StatusMark from './StatusMark.svelte';
  import { threadTone, workflowTone } from '../lib/thread-state';
  import Elapsed from './Elapsed.svelte';
  import { inStrip } from '../lib/one-status';

  let { store, threadId }: { store: Store; threadId: string } = $props();
  /**
   * Every subagent and workflow at work for this thread keeps its own entry in
   * the strip above the composer, by name, with its state and its time: a click
   * opens its panel. At work in a turn, or waiting on its own background work:
   * either way its result has not come back. A persistent agent's memory pass is
   * the core's upkeep, not a subagent it sent. The stream leaves these out
   * while they run (`settledCards`), so the strip is their one live line.
   */
  let active = $derived((store.delegation?.agents ?? []).filter(agent => inStrip(store, agent)));
  let native = $derived((store.delegation?.nativeAgents ?? []).filter(agent => agent.status === 'running'));
  let runs = $derived(store.workflowsOf(threadId).filter(run => run.status === 'running'));

  $effect(() => { void store.loadDelegation(threadId); });
  $effect(() => { void store.loadWorkflows(threadId); });

  function openAgent(id: string): void {
    store.showTeam();
    void store.selectDelegatedAgent(id);
  }

  interface Entry { key: string; name: string; startedAt: number; kind: string; open: () => void; workflow: boolean }
  let entries = $derived<Entry[]>([
    ...active.map((agent) => ({ key: agent.thread.id, name: agent.thread.title, startedAt: agent.lastTurn?.startedAt ?? agent.lastTurn?.queuedAt ?? agent.thread.createdAt, kind: 'agent', open: () => openAgent(agent.thread.id), workflow: false })),
    ...native.map((agent) => ({ key: agent.id, name: agent.name ?? agent.task ?? agent.id, startedAt: agent.startedAt, kind: 'native', open: () => store.showTeam(), workflow: false })),
    ...runs.map((run) => ({ key: run.id, name: run.name, startedAt: run.createdAt, kind: 'workflow', open: () => store.panel.openWorkflow(run.id), workflow: true }))
  ]);

</script>

{#if entries.length > 0}
  <div class="dock" data-testid="agent-dock">
    <div class="entries" role="group" data-testid="active-subagents" data-count={active.length + native.length} data-runs={runs.length}>
      {#each entries as entry (entry.key)}
        <button type="button" class="entry" data-testid="active-subagent" data-kind={entry.kind} title={entry.name} onclick={entry.open}>
          <StatusMark {...entry.workflow ? workflowTone('running', true) : threadTone('running')} />
          <span class="name ui-label">{entry.name}</span>
          <Elapsed startedAt={entry.startedAt} finishedAt={null} active />
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* Its rows in the strip, the way back at its right end. */
  .dock { display: contents; }
  /* Every entry whole at every width: what does not fit one row wraps to the
     next (never cut at the screen's edge, never folded into a count), and a
     long run scrolls inside three rows. */
  .entries {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 4px;
    flex: 1 1 0;
    min-width: 0;
    max-height: calc(3 * 28px + 4px);
    overflow-y: auto;
    scrollbar-width: none;
  }
  .entries::-webkit-scrollbar { display: none; }
  /* Quiet secondary entries: no pill, the mark and the name in muted ink; a hover brings the ink and the button. */
  .entry { flex: 0 1 auto; min-width: 0; max-width: 100%; height: 28px; gap: 6px; padding: 0 8px; border: none; border-radius: var(--radius-md); background: transparent; box-shadow: none; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; overflow: hidden; }
  .entry:hover { background: var(--color-hover); color: var(--color-foreground); }
  .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry :global(.elapsed) { flex: none; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  /* A phone gives the names the room: the mark says it runs, the panel says how long. */
  @media (max-width: 720px) {
    .entries { max-height: calc(3 * var(--touch-target) + 4px); }
    .entry { height: var(--touch-target); padding: 0 6px; }
    .entry :global(.elapsed) { display: none; }
  }
</style>
