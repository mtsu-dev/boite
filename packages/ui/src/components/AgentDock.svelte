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

  /** `progress` is a real fraction where one exists (a workflow's finished steps), null where only "at work" is known. */
  interface Entry { key: string; name: string; startedAt: number; kind: string; open: () => void; workflow: boolean; progress: number | null; doneAt?: number }
  let entries = $derived<Entry[]>([
    ...active.map((agent) => ({ key: agent.thread.id, name: agent.thread.title, startedAt: agent.lastTurn?.startedAt ?? agent.lastTurn?.queuedAt ?? agent.thread.createdAt, kind: 'agent', open: () => openAgent(agent.thread.id), workflow: false, progress: null })),
    ...native.map((agent) => ({ key: agent.id, name: agent.name ?? agent.task ?? agent.id, startedAt: agent.startedAt, kind: 'native', open: () => store.showTeam(), workflow: false, progress: null })),
    ...runs.map((run) => ({ key: run.id, name: run.name, startedAt: run.createdAt, kind: 'workflow', open: () => store.panel.openWorkflow(run.id), workflow: true, progress: run.nodes.length ? run.nodes.filter(node => node.status === 'done' || node.status === 'skipped').length / run.nodes.length : null }))
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
          {#if !done}<span class="track" class:known={entry.progress !== null} style:--progress={entry.progress ?? undefined} aria-hidden="true"></span>{/if}
        </button>
      {/each}
      {#if folded || open && rows.length > limit + 1}
        <button type="button" class="more" data-testid="agent-dock-more" aria-expanded={open} title={open ? undefined : fill(strings.delegation.dockMoreHint, { count: String(folded) })} onclick={() => { open = !open; }}>
          <span class="ui-label">{open ? strings.delegation.dockLess : fill(strings.delegation.dockMore, { count: String(folded) })}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* The dock's row form, shared with the decision's head, the question's head
     and the queued line (Composer sets `--dock-row` and `--dock-icon`): the
     mark in a fixed box at the left, the name, the time at the row's end, one
     row height and the meta type. Every entry keeps its own name and time, one
     per line on a phone, in even columns on a desktop; past the limit a "Show
     N more" action opens the rest in place. */
  .dock { flex: none; padding: var(--deck-gap, 6px) 6px 0; }
  .entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr)); gap: 0 4px; }
  /* One step under the decision: the meta type and the tertiary ink, no pill; a hover brings the ink and the fill. */
  .entry { position: relative; display: flex; align-items: center; justify-content: flex-start; gap: 8px; min-width: 0; min-height: var(--dock-row, 28px); height: auto; padding: 3px 8px; border: none; border-radius: var(--radius-md); background: transparent; box-shadow: none; color: var(--color-subtle); font-size: var(--text-meta); font-weight: 400; text-align: left; overflow: hidden; }
  .entry:hover { background: var(--color-hover); color: var(--color-foreground); }
  /* The mark sits in the box every dock row gives its icon, so a check takes the spinner's place and the names line up with the decision's title. */
  .mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--dock-icon, 16px); }
  .done .mark { color: var(--color-success); }
  /* The name gives way first, before the time loses a digit: a column too narrow for it (a side panel narrows the
     composer) takes it onto a second line at a space, so no word is hidden; only a third line would be cut. */
  .name { flex: 0 1 auto; min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; white-space: normal; line-height: 1.3; }
  .entry :global(.elapsed) { flex: none; margin-left: auto; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  /* A thin line under a running entry, from its name to its time: a known
     share fills solid from the start, an unknown one runs a segment with soft
     ends to and fro. Held by reduced motion (`--loops`), the segment stands
     still mid-track (the negative delay), so it never reads as a share. */
  .track { position: absolute; left: calc(8px + var(--dock-icon, 16px) + 8px); right: 8px; bottom: 0; height: 2px; border-radius: var(--radius-full); background: color-mix(in oklab, var(--color-subtle) 22%, transparent); overflow: hidden; pointer-events: none; }
  .track::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 32%; border-radius: inherit; background: linear-gradient(90deg, transparent, var(--color-accent), transparent); animation: dock-track 1.6s var(--loop-ease-in-out-48) -0.8s infinite alternate var(--loops); }
  .track.known::before { width: calc(var(--progress) * 100%); background: var(--color-accent); animation: none; transition: width var(--motion-duration) var(--motion-curve); }
  /* From the track's start to its end and back, the segment whole in sight at both ends. */
  @keyframes dock-track { from { transform: translateX(0); } to { transform: translateX(212.5%); } }
  /* The system's own ask holds it too, where `--loops` is not set: paused, not removed, so it stays mid-track. */
  @media (prefers-reduced-motion: reduce) { .track::before { animation-play-state: paused; } }
  /* "Show N more": an action in ink, underlined like a link, not a caption. */
  .more { justify-self: start; height: var(--dock-row, 28px); padding: 0 8px 0 calc(8px + var(--dock-icon, 16px) + 8px); border: none; background: transparent; box-shadow: none; color: var(--color-foreground); font-size: var(--text-meta); font-weight: 550; }
  .more .ui-label { text-decoration: underline; text-decoration-color: color-mix(in oklab, currentColor 45%, transparent); text-decoration-thickness: 1px; text-underline-offset: 3px; }
  .more:hover { background: transparent; }
  .more:hover .ui-label { text-decoration-color: currentColor; }
  @media (max-width: 720px) { .entries { grid-template-columns: minmax(0, 1fr); } }
</style>
