<script lang="ts">
  import { threadBusy } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import StatusMark from './StatusMark.svelte';
  import { threadTone, workflowTone } from '../lib/thread-state';
  import Elapsed from './Elapsed.svelte';
  import { upkeepOf } from '../lib/agent-upkeep';
  import { fill, strings } from '../lib/strings';

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

  interface Entry { key: string; name: string; startedAt: number; kind: string; open: () => void; workflow: boolean }
  let entries = $derived<Entry[]>([
    ...active.map((agent) => ({ key: agent.thread.id, name: agent.thread.title, startedAt: agent.lastTurn?.startedAt ?? agent.lastTurn?.queuedAt ?? agent.thread.createdAt, kind: 'agent', open: () => openAgent(agent.thread.id), workflow: false })),
    ...native.map((agent) => ({ key: agent.id, name: agent.name ?? agent.task ?? agent.id, startedAt: agent.startedAt, kind: 'native', open: () => store.showTeam(), workflow: false })),
    ...runs.map((run) => ({ key: run.id, name: run.name, startedAt: run.createdAt, kind: 'workflow', open: () => store.panel.openWorkflow(run.id), workflow: true }))
  ]);

  /*
   * The entries share the strip's width: a row holds as many as fit at the
   * narrowest an entry stays readable, each shrinking its name to an ellipsis
   * inside it, never cut by the edge. Two rows at most; what they cannot hold
   * is one "+N" that opens the subagents. Unmeasured (no layout yet), one row.
   */
  const NARROWEST = 132, GAP = 8;
  let width = $state(0);
  let perRow = $derived(width > 0 ? Math.max(1, Math.floor((width + GAP) / (NARROWEST + GAP))) : Math.max(1, entries.length));
  let fits = $derived(entries.length <= perRow * 2);
  let shown = $derived(fits ? entries : entries.slice(0, perRow * 2 - 1));
  let rows = $derived(shown.length > perRow || !fits ? [shown.slice(0, perRow), shown.slice(perRow)] : [shown]);
  let more = $derived(entries.length - shown.length);
</script>

{#if entries.length > 0}
  <div class="dock" data-testid="agent-dock">
    <div class="entries" role="group" bind:clientWidth={width} data-testid="active-subagents" data-count={active.length + native.length} data-runs={runs.length}>
      {#each rows as row, at (at)}
        <div class="row">
          {#each row as entry (entry.key)}
            <button type="button" class="entry" data-testid="active-subagent" data-kind={entry.kind} title={entry.name} onclick={entry.open}>
              <StatusMark {...entry.workflow ? workflowTone('running', true) : threadTone('running')} />
              <span class="name ui-label">{entry.name}</span>
              <Elapsed startedAt={entry.startedAt} finishedAt={null} active />
            </button>
          {/each}
          {#if more > 0 && at === rows.length - 1}
            {@const hint = fill(strings.activity.moreRunningHint, { count: String(more) })}
            <button type="button" class="entry more" data-testid="active-subagents-more" title={hint} aria-label={hint} onclick={() => store.showTeam()}><span class="ui-label">{fill(strings.activity.moreRunning, { count: String(more) })}</span></button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* Its own row or two in the strip; the queue and the way back go under it. */
  .dock { display: contents; }
  .entries { display: flex; flex-direction: column; gap: 8px; flex: 1 1 100%; min-width: 0; }
  .row { display: flex; gap: 8px; min-width: 0; }
  .entry { flex: 0 1 auto; min-width: 96px; max-width: 100%; height: 30px; gap: 6px; padding: 0 10px; border: 1px solid var(--color-edge); border-radius: var(--radius-lg); background: var(--color-surface-2); color: var(--color-foreground); font-size: var(--text-sm); font-weight: 550; overflow: hidden; }
  .entry:hover { background: var(--color-surface-3); }
  .entry.more { flex: none; min-width: 0; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry :global(.elapsed) { flex: none; color: var(--color-muted-foreground); font-weight: 400; font-variant-numeric: tabular-nums; }
  /* A phone gives the names the room: the mark says it runs, the panel says how long. */
  @media (max-width: 720px) { .entry :global(.elapsed) { display: none; } }
</style>
