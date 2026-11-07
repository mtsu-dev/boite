<script lang="ts">
  import { tick } from 'svelte';
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
   * The entries fill the strip in order, each at its whole name's width (a
   * hidden copy measures them, its timer at its widest): an entry that does
   * not fit the row's rest starts the next row. Two rows at most; what they
   * cannot hold is one "+N" that opens the subagents. Only a name wider than
   * the strip itself ends in an ellipsis. Unmeasured (no layout yet), one row.
   */
  const GAP = 8, MORE = 48;
  let width = $state(0);
  let measurer = $state<HTMLDivElement | undefined>(undefined);
  let natural = $state<number[]>([]);
  $effect(() => {
    void entries.length; void entries.map((entry) => entry.name).join('\n'); void width;
    let current = true;
    void tick().then(() => {
      if (!current || !measurer) return;
      natural = Array.from(measurer.children, (child) => Math.ceil((child as HTMLElement).getBoundingClientRect().width));
    });
    return () => { current = false; };
  });
  let rows = $derived.by((): Entry[][] => {
    if (width <= 0 || natural.length !== entries.length) return [entries];
    const packed: Entry[][] = [[]];
    let used = 0, at = 0;
    for (; at < entries.length; at++) {
      const need = natural[at]!, row = packed[packed.length - 1]!;
      if (row.length > 0 && used + GAP + need > width) {
        if (packed.length === 2) break;
        packed.push([]); used = 0;
      }
      used += (packed[packed.length - 1]!.length > 0 ? GAP : 0) + need;
      packed[packed.length - 1]!.push(entries[at]!);
    }
    // The "+N" takes its room on the last row from the entries before it.
    if (at < entries.length) {
      const last = packed[packed.length - 1]!;
      let room = last.reduce((sum, entry) => sum + natural[entries.indexOf(entry)]! + GAP, 0) + MORE;
      while (last.length > 1 && room > width) room -= natural[entries.indexOf(last.pop()!)]! + GAP;
    }
    return packed;
  });
  let more = $derived(entries.length - rows.reduce((sum, row) => sum + row.length, 0));
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
    <div class="measure" bind:this={measurer} aria-hidden="true" inert>
      {#each entries as entry (entry.key)}
        <span class="entry"><StatusMark {...entry.workflow ? workflowTone('running', true) : threadTone('running')} /><span class="name ui-label">{entry.name}</span><span class="elapsed ui-label">00m 00s</span></span>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* Its own row or two in the strip; the queue and the way back go under it. */
  .dock { display: contents; }
  .measure { position: absolute; visibility: hidden; pointer-events: none; display: flex; gap: 8px; width: max-content; height: 0; overflow: hidden; }
  .measure .entry { display: inline-flex; flex: none; align-items: center; gap: 6px; min-width: 0; max-width: none; white-space: nowrap; }
  .measure .elapsed { flex: none; font-weight: 400; font-variant-numeric: tabular-nums; }
  .entries { display: flex; flex-direction: column; gap: 8px; flex: 1 1 100%; min-width: 0; }
  .row { display: flex; gap: 8px; min-width: 0; }
  .entry { flex: 0 1 auto; min-width: 96px; max-width: 100%; height: 30px; gap: 6px; padding: 0 10px; border: 1px solid var(--color-edge); border-radius: var(--radius-lg); background: var(--color-surface-2); color: var(--color-foreground); font-size: var(--text-sm); font-weight: 550; overflow: hidden; }
  .entry:hover { background: var(--color-surface-3); }
  .entry.more { flex: none; min-width: 0; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry :global(.elapsed) { flex: none; color: var(--color-muted-foreground); font-weight: 400; font-variant-numeric: tabular-nums; }
  /* A phone gives the names the room: the mark says it runs, the panel says how long. */
  @media (max-width: 720px) { .entry :global(.elapsed), .measure .elapsed { display: none; } }
</style>
