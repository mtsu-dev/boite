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

  /*
   * One line at every width, each entry whole and its own (never folded into
   * a count): what does not fit scrolls sideways, a fade marks the side that
   * has more (in CSS, from the scroll itself), and a mouse wheel scrolls it too.
   */

  // Non-passive, so a vertical wheel over an overflowing line moves it instead of the page.
  function sideways(node: HTMLElement) {
    const onwheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY;
    };
    node.addEventListener('wheel', onwheel, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', onwheel) };
  }
</script>

{#if entries.length > 0}
  <div class="dock" data-testid="agent-dock">
    <div class="entries" role="group" use:sideways data-testid="active-subagents" data-count={active.length + native.length} data-runs={runs.length}>
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
  /* Its one line in the strip, the way back at its right end. */
  .dock { display: contents; }
  .entries {
    display: flex;
    gap: 4px;
    flex: 1 1 0;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .entries::-webkit-scrollbar { display: none; }
  /* The fades follow the line's own scroll: none while it fits (no scroll, no
     timeline), the end's at its start, both midway, the start's at its end. */
  @property --fade-start { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @property --fade-end { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @keyframes edge-fades {
    from { --fade-start: 0px; --fade-end: 28px; }
    8% { --fade-start: 28px; }
    92% { --fade-end: 28px; }
    to { --fade-start: 28px; --fade-end: 0px; }
  }
  @supports (animation-timeline: scroll()) {
    .entries {
      mask-image: linear-gradient(to right, transparent, currentColor var(--fade-start), currentColor calc(100% - var(--fade-end)), transparent);
      animation: edge-fades linear both;
      animation-timeline: scroll(self inline);
    }
  }
  /* Quiet one-line entries: no pill, the mark and the name; a hover shows the button. */
  .entry { flex: none; max-width: 16rem; height: 28px; gap: 6px; padding: 0 8px; border: none; border-radius: var(--radius-md); background: transparent; box-shadow: none; color: var(--color-foreground); font-size: var(--text-sm); font-weight: 500; overflow: hidden; }
  .entry:hover { background: var(--color-hover); }
  .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry :global(.elapsed) { flex: none; color: var(--color-muted-foreground); font-weight: 400; font-variant-numeric: tabular-nums; }
  /* A phone gives the names the room: the mark says it runs, the panel says how long. */
  @media (max-width: 720px) {
    .entry { max-width: 12rem; }
    .entry :global(.elapsed) { display: none; }
  }
</style>
