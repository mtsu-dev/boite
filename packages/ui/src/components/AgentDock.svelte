<script lang="ts">
  import { untrack } from 'svelte';
  import { Check, ChevronUp } from '@lucide/svelte';
  import type { DelegatedAgent } from '@boite/contracts';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import Spinner from './Spinner.svelte';
  import FailMark from './FailMark.svelte';
  import { threadTone, workflowTone } from '../lib/thread-state';
  import Elapsed from './Elapsed.svelte';
  import { inStrip } from '../lib/one-status';
  import { wordFit } from '../lib/word-fit';
  import { workspace } from '../lib/workspace.svelte';

  let { store, threadId, height = $bindable(0) }: { store: Store; threadId: string; height?: number } = $props();
  /**
   * The subagents and workflows at work for this thread, as one row on the
   * composer card's top edge: one alone shows its name and time, several fold
   * into "3 active", which opens on the list of them in place. Each entry opens
   * its own conversation. At work in a turn, or waiting on its own background
   * work: either way its result has not come back. A persistent agent's memory
   * pass is the core's upkeep, not a subagent it sent. The stream leaves these
   * out while they run (`settledCards`), so the dock is their one live line;
   * what a subagent asks is the decision card at the timeline's end.
   */
  // The team and the runs are the root conversation's: a subagent's own dock counts only the ones it sent, never itself, its siblings or the root's runs.
  let root = $derived((store.delegation?.rootThreadId ?? threadId) === threadId);
  let active = $derived((store.delegation?.agents ?? []).filter(agent => inStrip(store, agent) && (root || agent.thread.parentThreadId === threadId)));
  let native = $derived((store.delegation?.nativeAgents ?? []).filter(agent => agent.status === 'running'));
  let runs = $derived(store.workflowsOf(threadId).filter(run => run.status === 'running' && run.rootThreadId === threadId));
  let asking = $derived(new Set(store.subagentQuestions(threadId).map(child => child.threadId)));

  $effect(() => { void store.loadDelegation(threadId); });
  $effect(() => { void store.loadWorkflows(threadId); });

  /** A subagent reads like any conversation: its own, on the machine that runs it. One whose machine is out of reach opens the team. */
  function openAgent(agent: DelegatedAgent): void {
    if (!agent.machine) { void store.open(agent.thread.id); return; }
    const machine = workspace.machineOf(agent.machine.coreId);
    if (machine?.store.connection === 'ready') void workspace.select(machine.store, agent.thread.id);
    else store.showTeam();
  }

  type Ending = 'done' | 'failed';
  interface Entry { key: string; name: string; startedAt: number; kind: string; open: () => void; endedAt?: number; ended?: Ending }
  // A provider's own subagent has no conversation here: the team lists it. A workflow opens its graph, where each step opens its own.
  let entries = $derived<Entry[]>([
    ...active.map((agent) => ({ key: agent.thread.id, name: agent.thread.title, startedAt: agent.lastTurn?.startedAt ?? agent.lastTurn?.queuedAt ?? agent.thread.createdAt, kind: 'agent', open: () => openAgent(agent) })),
    ...native.map((agent) => ({ key: agent.id, name: agent.name ?? agent.task ?? agent.id, startedAt: agent.startedAt, kind: 'native', open: () => store.showTeam() })),
    ...runs.map((run) => ({ key: run.id, name: run.name, startedAt: run.createdAt, kind: 'workflow', open: () => store.panel.openWorkflow(run.id) }))
  ]);

  /** How an entry that left the work ended: a moment with its check or its red mark says so before it goes. */
  const endingOf = (key: string): Ending | null => {
    const status = [
      ...(store.delegation?.agents ?? []).map(agent => [agent.thread.id, agent.lastTurn?.status]),
      ...(store.delegation?.nativeAgents ?? []).map(agent => [agent.id, agent.status]),
      ...store.workflowsOf(threadId).map(run => [run.id, run.status])
    ].find(([id]) => id === key)?.[1];
    return status === 'done' ? 'done' : status === 'error' || status === 'failed' ? 'failed' : null;
  };
  let leaving = $state<Entry[]>([]);
  let shown: Entry[] = [];
  $effect(() => {
    const keys = new Set(entries.map(entry => entry.key)), endedAt = Date.now();
    const left = shown.filter(entry => !keys.has(entry.key)).flatMap(entry => {
      const ended = endingOf(entry.key);
      return ended ? [{ ...entry, endedAt, ended }] : [];
    });
    shown = entries;
    if (!left.length) return;
    untrack(() => { leaving = [...leaving, ...left]; });
    setTimeout(() => { leaving = leaving.filter(entry => entry.endedAt !== endedAt); }, 1600);
  });
  // One key, one row: an entry back at work drops its mark.
  let rows = $derived([...entries, ...leaving.filter(entry => !entries.some(({ key }) => key === entry.key))]);
  const stateOf = (entry: Entry) => entry.ended ?? (asking.has(entry.key) ? 'asking' : 'working');
  let live = $derived(entries.length);
  let asks = $derived(rows.filter(entry => stateOf(entry) === 'asking').length);
  let failed = $derived(rows.filter(entry => entry.ended === 'failed').length);
  let summary = $derived(live ? (live === 1 ? strings.delegation.dockActiveOne : fill(strings.delegation.dockActive, { count: String(live) }))
    : rows.length - failed === 1 ? strings.delegation.dockDoneOne : fill(strings.delegation.dockDone, { count: String(rows.length - failed) }));

  /** Folded until asked, while its thread stays open: another thread, or this one opened again, starts folded. */
  let unfolded = $state(false);
  let open = $derived(unfolded && rows.length > 1);
  $effect.pre(() => { void threadId; unfolded = false; });
  function toggle(): void { unfolded = !open; }
  // The keys the button would turn into a click, handled here once (the default is prevented, so no second toggle).
  function onkey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
    else if (event.key === 'Escape' && open) { event.stopPropagation(); unfolded = false; }
  }
  const listId = $props.id();

  let measured = $state(0);
  // Gone, the rows give their room back: a removed element's binding keeps its last height.
  $effect(() => { height = rows.length ? measured : 0; });
</script>

{#snippet line(entry: Entry)}
  {@const state = stateOf(entry)}
  <button type="button" class="row entry" data-testid="active-subagent" data-kind={entry.kind} data-state={state} data-done={state === 'done' || undefined} title={entry.name} onclick={entry.open}>
    <span class="mark">
      {#if state === 'done'}<Check size={12} strokeWidth={2.25} aria-label={strings.delegation.dockState.done} />
      {:else if state === 'failed'}<span role="img" aria-label={strings.delegation.dockState.failed} title={strings.delegation.dockState.failed}><FailMark /></span>
      {:else if state === 'asking'}<span class="dot" aria-hidden="true"></span>
      {:else}<Spinner size={11} label={(entry.kind === 'workflow' ? workflowTone('running', true) : threadTone('running')).label} />{/if}
    </span>
    <span class="name ui-label" use:wordFit={entry.name}></span>
    {#if state !== 'working'}<span class="state ui-label" data-state={state}>{strings.delegation.dockState[state]}</span>{/if}
    <Elapsed startedAt={entry.startedAt} finishedAt={entry.endedAt ?? null} active={entry.endedAt === undefined} />
  </button>
{/snippet}

{#if rows.length > 0}
  <div class="dock" data-testid="agent-dock" bind:clientHeight={measured}>
    <div class="entries" role="group" aria-label={summary} data-testid="active-subagents" data-count={active.length + native.length} data-runs={runs.length}>
      {#if rows.length === 1}
        {@render line(rows[0]!)}
      {:else}
        <!-- The list opens above its row, so the row stays where it was clicked, next to the field. -->
        <div class="disclosure-fold" class:open inert={!open}>
          <div>
            <ul class="list scroll-edges" id={listId} data-testid="agent-dock-list">
              {#each rows as entry (entry.key)}<li>{@render line(entry)}</li>{/each}
            </ul>
          </div>
        </div>
        <button type="button" class="row fold" data-testid="agent-dock-toggle" aria-expanded={open} aria-controls={listId} onclick={toggle} onkeydown={onkey}>
          <span class="mark">{#if live}<Spinner size={11} />{:else}<Check size={12} strokeWidth={2.25} />{/if}</span>
          <span class="count ui-label">{summary}</span>
          {#if asks}
            {@const label = asks === 1 ? strings.delegation.dockAskingOne : fill(strings.delegation.dockAsking, { count: String(asks) })}
            <span class="flag" data-testid="agent-dock-asking" role="img" aria-label={label} title={label}><span class="dot"></span>{asks}</span>
          {/if}
          {#if failed}
            {@const label = fill(strings.delegation.failed, { count: String(failed) })}
            <span class="flag" data-testid="agent-dock-failed" role="img" aria-label={label} title={label}><FailMark />{failed}</span>
          {/if}
          <ChevronUp size={16} class="chevron" aria-hidden="true" />
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* The dock's row form, shared with the decision's head and the queued line
     (Composer sets `--dock-row` and `--dock-icon`): the mark in a fixed box at
     the left, the words, the time or the chevron at the row's end, one row
     height and the meta type. */
  .dock { flex: none; padding: var(--deck-gap, 6px) 6px 0; }
  .entries { display: flex; flex-direction: column; min-width: 0; }
  .row { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; min-width: 0; min-height: var(--dock-row, 28px); height: auto; padding: 3px 8px; border: none; border-radius: var(--radius-md); background: transparent; box-shadow: none; color: var(--color-muted-foreground); font-size: var(--text-meta); font-weight: 400; text-align: left; }
  .row:hover { background: var(--color-hover); color: var(--color-foreground); }
  /* The mark sits in the box every dock row gives its icon, so a check takes the spinner's place and the names line up with the decision's title. */
  .mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--dock-icon, 16px); }
  .entry[data-state='done'] .mark { color: var(--color-success); }
  .fold .mark :global(svg) { color: var(--color-success); }
  /* Amber says that one waits on the user; the decision itself is the card in the transcript. */
  .dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-live); }
  /* One line, cut between words (`wordFit`); the time keeps every digit. Its
     width comes from the row, never from its words, so a cut cannot resize it. */
  .name { flex: 1 1 0; min-width: 0; overflow: hidden; white-space: nowrap; }
  .state { flex: none; white-space: nowrap; color: var(--color-subtle); }
  .state[data-state='asking'] { color: var(--color-foreground); }
  .entry :global(.elapsed) { flex: none; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  .count { flex: 0 1 auto; min-width: 0; white-space: nowrap; color: var(--color-foreground); font-weight: 550; font-variant-numeric: tabular-nums; }
  .flag { display: inline-flex; align-items: center; gap: 5px; flex: none; color: var(--color-foreground); font-weight: 550; font-variant-numeric: tabular-nums; }
  .fold :global(.chevron) { flex: none; margin-left: auto; color: var(--color-subtle); transition: transform var(--motion-duration) var(--motion-curve); }
  .fold[aria-expanded='true'] :global(.chevron) { transform: rotate(180deg); }
  /* About five rows on a desktop, four on a phone, then the list scrolls; its
     height is whole rows, so the fade at its foot ends on a row's edge. */
  .list { --scroll-edge-ground: var(--color-composer-surface); display: flex; flex-direction: column; max-height: calc(var(--dock-row, 28px) * 5); margin: 0; padding: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; list-style: none; }
  .list li { flex: none; }
  @media (max-width: 720px) { .list { max-height: calc(var(--dock-row, 30px) * 4); } }
  @media (prefers-reduced-motion: reduce) { .fold :global(.chevron) { transition: none; } }
</style>
