<script lang="ts">
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Check } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import Spinner from './Spinner.svelte';
  import { threadTone, workflowTone } from '../lib/thread-state';
  import Elapsed from './Elapsed.svelte';
  import { inStrip } from '../lib/one-status';

  let { store, threadId, height = $bindable(0) }: { store: Store; threadId: string; height?: number } = $props();
  /**
   * Every subagent and workflow at work for this thread keeps its own entry on
   * the composer card's top edge, by name, with the tool rows' working mark and
   * its time: a click opens its panel. At work in a turn, or waiting on its own
   * background work: either way its result has not come back. A persistent
   * agent's memory pass is the core's upkeep, not a subagent it sent. The
   * stream leaves these out while they run (`settledCards`), so the dock is
   * their one live line.
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

  interface Entry { key: string; name: string; startedAt: number; kind: string; open: () => void; workflow: boolean; doneAt?: number }
  let entries = $derived<Entry[]>([
    ...active.map((agent) => ({ key: agent.thread.id, name: agent.thread.title, startedAt: agent.lastTurn?.startedAt ?? agent.lastTurn?.queuedAt ?? agent.thread.createdAt, kind: 'agent', open: () => openAgent(agent.thread.id), workflow: false })),
    ...native.map((agent) => ({ key: agent.id, name: agent.name ?? agent.task ?? agent.id, startedAt: agent.startedAt, kind: 'native', open: () => store.showTeam(), workflow: false })),
    ...runs.map((run) => ({ key: run.id, name: run.name, startedAt: run.createdAt, kind: 'workflow', open: () => store.panel.openWorkflow(run.id), workflow: true }))
  ]);

  /** Finished well: an entry that leaves for this shows its check a moment first. */
  const done = (key: string) => [
    ...(store.delegation?.agents ?? []).map(agent => [agent.thread.id, agent.lastTurn?.status]),
    ...(store.delegation?.nativeAgents ?? []).map(agent => [agent.id, agent.status]),
    ...store.workflowsOf(threadId).map(run => [run.id, run.status])
  ].some(([id, status]) => id === key && status === 'done');
  let leaving = $state<Entry[]>([]);
  let shown: Entry[] = [];
  $effect(() => {
    const keys = new Set(entries.map(entry => entry.key)), doneAt = Date.now();
    const left = shown.filter(entry => !keys.has(entry.key) && done(entry.key)).map(entry => ({ ...entry, doneAt }));
    shown = entries;
    if (!left.length) return;
    untrack(() => { leaving = [...leaving, ...left]; });
    setTimeout(() => { leaving = leaving.filter(entry => entry.doneAt !== doneAt); }, 1600);
  });
  // One key, one row: an entry back at work drops its check.
  let rows = $derived([...entries, ...leaving.filter(entry => !entries.some(({ key }) => key === entry.key))]);
  /**
   * Past a few entries (two lines of chips on a desktop, three rows on a
   * phone) the last ones fold behind a "+N" entry that counts them and opens
   * them in place, so none is ever cut away out of sight.
   */
  const phone = new MediaQuery('(max-width: 720px)');
  let open = $state(false);
  let limit = $derived(phone.current ? 3 : 6);
  let folded = $derived(open || rows.length <= limit + 1 ? 0 : rows.length - limit);
  let shownRows = $derived(folded ? rows.slice(0, limit) : rows);
  let measured = $state(0);
  // Gone, the rows give their room back: a removed element's binding keeps its last height.
  $effect(() => { height = rows.length ? measured : 0; });
</script>

{#if rows.length > 0}
  <div class="dock" data-testid="agent-dock" bind:clientHeight={measured}>
    <div class="entries" role="group" data-testid="active-subagents" data-count={active.length + native.length} data-runs={runs.length}>
      {#each shownRows as entry (entry.key)}
        {@const done = entry.doneAt !== undefined}
        <button type="button" class="entry" class:done data-testid="active-subagent" data-kind={entry.kind} data-done={done || undefined} title={entry.name} onclick={entry.open}>
          <span class="mark">{#if done}<Check size={12} strokeWidth={2.25} aria-label={workflowTone('done', true).label} />{:else}<Spinner size={11} label={(entry.workflow ? workflowTone('running', true) : threadTone('running')).label} />{/if}</span>
          <span class="name ui-label">{entry.name}</span>
          <Elapsed startedAt={entry.startedAt} finishedAt={entry.doneAt ?? null} active={!done} />
        </button>
      {/each}
      {#if folded || open && rows.length > limit + 1}
        <button type="button" class="entry more" data-testid="agent-dock-more" aria-expanded={open} title={open ? undefined : fill(strings.delegation.dockMoreHint, { count: String(folded) })} onclick={() => { open = !open; }}>
          <span class="ui-label">{open ? strings.delegation.dockLess : fill(strings.delegation.dockMore, { count: String(folded) })}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Quiet chips on the card's top edge, on its own surface with no rule
     under them: only a decision below is raised. Every entry keeps its own
     name, mark and time, side by side while they fit and wrapping when they
     do not (never folded into a count); past the limit a "+N" entry opens the
     rest. Their marks line up with the field's text (8 px of chip padding). */
  .dock { flex: none; padding: 6px 6px 0; }
  .entries { display: flex; flex-wrap: wrap; align-items: center; gap: 0 4px; }
  /* Muted ink, no pill; a hover brings the ink and the fill. */
  .entry { flex: 0 1 auto; min-width: 0; max-width: 100%; height: var(--control-sm); gap: 6px; padding: 0 8px; border: none; border-radius: var(--radius-md); background: transparent; box-shadow: none; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; overflow: hidden; }
  .entry:hover { background: var(--color-hover); color: var(--color-foreground); }
  /* The mark sits in the box the tool rows give theirs, so a check takes the spinner's place. */
  .mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 12px; }
  .done .mark { color: var(--color-success); }
  .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry :global(.elapsed) { flex: none; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  .more { flex: none; color: var(--color-foreground); font-weight: 600; }
  /* A phone keeps every name readable on rows a finger still hits (over the
     28 px floor), the time at the end of each. */
  @media (max-width: 720px) {
    .entries { gap: 2px 4px; }
    .entry { height: 30px; padding: 0 6px; }
  }
</style>
