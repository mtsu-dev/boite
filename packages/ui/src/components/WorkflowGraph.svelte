<script lang="ts">
  import { ArrowDown, Repeat } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { conditionText, type DelegationProfile, type WorkflowNode, type WorkflowRun } from '@boite/contracts';
  import { fill, strings } from '../lib/strings';
  import { edgesOf, fitsPhase, loopsOf, nodeProgress, nodeTiming, nodeTokens, phasesOf, roundLabel, routeOf, type WorkflowLoop } from '../lib/workflow-view';
  import { formatTokens, levelName } from '../lib/format';
  import Elapsed from './Elapsed.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import StatusMark from './StatusMark.svelte';
  import { workflowTone } from '../lib/thread-state';

  /**
   * The run top to bottom, one row per dependency level, the steps of a row
   * side by side and an arrow down from each step to the ones waiting for it.
   * The panel is taller than wide, so the plan grows down the way it runs.
   * A row too wide for the graph (many steps at once on a phone) turns the
   * whole run into a list of phases, one step under the other.
   * A `repeat` loop draws a dashed arc on the right, from the step that
   * closes it back up to the one it starts from, past every card between.
   */
  let {
    run,
    profiles,
    selectedId,
    onselect
  }: { run: WorkflowRun; profiles: DelegationProfile[]; selectedId: string | null; onselect: (nodeId: string) => void } = $props();

  const uid = $props.id();
  /**
   * Arcs run in the graph's right padding widened by LOOP_ROOM, small enough
   * that two steps side by side still fit the panel's default width; a loop
   * that shares rows with another runs one LOOP_STEP further out.
   */
  const LOOP_ROOM = 8;
  const LOOP_GAP = 13;
  const LOOP_STEP = 7;
  let rows = $state<HTMLDivElement | undefined>(undefined);
  let width = $state(0);
  let paths = $state<{ key: string; d: string; live: boolean }[]>([]);
  let arcs = $state<{ loop: WorkflowLoop; d: string; x: number; y: number }[]>([]);

  let phases = $derived(phasesOf(run));
  let edges = $derived(edgesOf(run));
  // The widest row decides, less the graph's 16px side padding.
  let loops = $derived(loopsOf(run));
  let closing = $derived(new Map(loops.map(loop => [loop.to, loop])));
  // The widest row decides, less the room a loop's arc takes on the right.
  let wide = $derived(fitsPhase(width - 32 - (loops.length ? LOOP_ROOM : 0), Math.max(0, ...phases.map(phase => phase.length))));
  let byId = $derived(new Map(run.nodes.map(node => [node.id, node])));

  /**
   * Arrows are drawn from the laid-out cards, so a card that grows moves its
   * arrows with it. The SVG fills the rows it sits in and takes no size of
   * its own: sized from a scroll width, it would hold the width of a wider
   * panel after a resize.
   */
  function measure(): void {
    const node = rows;
    if (!node || !wide) {
      paths = [];
      arcs = [];
      return;
    }
    const origin = node.getBoundingClientRect();
    const rect = (id: string) => node.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
    const next: typeof paths = [];
    for (const edge of edges) {
      const from = rect(edge.from), to = rect(edge.to);
      if (!from || !to) continue;
      const x1 = from.left + from.width / 2 - origin.left;
      const y1 = from.bottom - origin.top;
      const x2 = to.left + to.width / 2 - origin.left;
      const y2 = to.top - origin.top - 3;
      const bend = Math.max(10, (y2 - y1) / 2);
      next.push({
        key: `${edge.from}>${edge.to}`,
        d: `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`,
        live: byId.get(edge.to)?.status === 'running'
      });
    }
    paths = next;
    arcs = loopArcs(node, origin, rect);
  }

  /**
   * Each arc leaves the closing step's right edge, runs up past the right
   * edge of every card in the rows it spans, and comes back into the first
   * step of the loop with an arrow. A loop of one step curls on its own edge.
   */
  function loopArcs(node: HTMLElement, origin: DOMRect, rect: (id: string) => DOMRect | undefined): typeof arcs {
    const row = new Map(phases.flatMap((phase, index) => phase.map(step => [step.id, index] as const)));
    const out: typeof arcs = [];
    const spans: [number, number][] = [];
    for (const loop of loops) {
      const from = rect(loop.from), to = rect(loop.to);
      const top = row.get(loop.from), bottom = row.get(loop.to);
      if (!from || !to || top === undefined || bottom === undefined) continue;
      const lane = spans.filter(([a, b]) => a <= bottom && top <= b).length;
      spans.push([top, bottom]);
      const right = Math.max(...phases.slice(top, bottom + 1).flat().map(step => rect(step.id)?.right ?? 0));
      const x = Math.min(right - origin.left + LOOP_GAP + lane * LOOP_STEP, node.clientWidth + 8);
      const x1 = to.right - origin.left, x2 = from.right - origin.left + 1;
      if (loop.from === loop.to) {
        const y = to.top + Math.min(to.height / 2, 22) - origin.top, r = Math.min(6, to.height / 2 - 2);
        out.push({ loop, x, y, d: `M${x1},${y + r} H${x - r} A${r},${r} 0 0 0 ${x - r},${y - r} H${x2}` });
        continue;
      }
      const y1 = to.top + Math.min(to.height / 2, 22) - origin.top, y2 = from.top + Math.min(from.height / 2, 22) - origin.top;
      const r = Math.min(6, (y1 - y2) / 2);
      out.push({ loop, x, y: (y1 + y2) / 2, d: `M${x1},${y1} H${x - r} A${r},${r} 0 0 0 ${x},${y1 - r} V${y2 + r} A${r},${r} 0 0 0 ${x - r},${y2} H${x2}` });
    }
    return out;
  }

  function loopTitle(loop: WorkflowLoop): string {
    return fill(strings.workflow.loopTitle, { round: String(loop.round), max: String(loop.max), from: byId.get(loop.from)?.title ?? loop.from, condition: conditionText(loop.until) });
  }

  $effect(() => {
    void run;
    void wide;
    void width;
    void tick().then(measure);
  });

  $effect(() => {
    const node = rows;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  });

  function hint(node: WorkflowNode): string | null {
    if (node.instances.length > 0) return null;
    if (node.forEach) return fill(strings.workflow.forEach, { path: node.forEach });
    return null;
  }
</script>

{#snippet card(node: WorkflowNode)}
  {@const progress = nodeProgress(node)}
  {@const route = routeOf(node, profiles, run.plan.steps.find(step => step.id === node.id))}
  {@const timing = nodeTiming(node)}
  {@const note = hint(node)}
  {@const loop = closing.get(node.id)}
  <button
    type="button"
    class="node {node.status}"
    class:selected={selectedId === node.id}
    data-node-id={node.id}
    data-status={node.status}
    data-testid="workflow-node"
    title={node.error ?? node.title}
    onclick={() => onselect(node.id)}
  >
    <span class="head">
      <StatusMark {...workflowTone(node.status)} />
      <span class="name ui-label">{node.title}</span>
      {#if node.forEach && progress.total > 0}<span class="count ui-label" data-testid="workflow-node-count">{progress.done}/{progress.total}</span>{/if}
      {#if loop}<span class="round {loop.state}" title={loopTitle(loop)} data-testid="workflow-round"><Repeat size={11} strokeWidth={2} />{roundLabel(loop)}</span>{/if}
    </span>
    {#if route}
      <span class="route"><ProviderLogo providerId={route.providerId} size={12} /><span class="model ui-label">{route.model || route.profile}</span>{#if route.effort}<span class="effort ui-label" data-testid="workflow-effort">{levelName({ id: route.effort, label: route.effort })}</span>{/if}</span>
    {/if}
    {#if node.forEach && progress.total > 0}
      <span class="bar" aria-hidden="true">
        {#each node.instances as inst (inst.key)}<i class={inst.status}></i>{/each}
      </span>
    {/if}
    {#if note}<span class="note ui-label">{note}</span>{/if}
    {#if loop && !wide}<span class="note ui-label">{fill(strings.workflow.loopsBack, { step: byId.get(loop.from)?.title ?? loop.from })}</span>{/if}
    {#if node.status === 'skipped'}
      <span class="note ui-label">{strings.workflow.stepStatus.skipped}</span>
    {:else if timing.startedAt !== null}
      <span class="note metrics"><Elapsed startedAt={timing.startedAt} finishedAt={timing.finishedAt} active={timing.active} />{#if node.instances.some(inst => inst.usage !== undefined)}<span>·</span><span data-testid="workflow-node-tokens" title={strings.workflow.tokensHelp}>{fill(strings.workflow.tokens, { tokens: formatTokens(nodeTokens(node)) })}</span>{/if}</span>
    {/if}
  </button>
{/snippet}

<div class="graph" bind:clientWidth={width} data-testid="workflow-graph" data-layout={wide ? 'rows' : 'list'}>
  {#if wide}
    <div class="rows" class:looped={loops.length > 0} bind:this={rows}>
      <svg class="edges" aria-hidden="true">
        <defs>
          <marker id="{uid}-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" class="tip" /></marker>
          <marker id="{uid}-arrow-live" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" class="tip live" /></marker>
          <!-- A loop's arrow is smaller: the gutter it lands in is a few pixels wide. -->
          {#each ['idle', 'live', 'over', 'failed'] as state (state)}
            <marker id="{uid}-loop-{state}" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L6,3 L0,6 z" class="loop-tip {state}" /></marker>
          {/each}
        </defs>
        {#each paths as path (path.key)}
          <path d={path.d} class="edge" class:live={path.live} marker-end="url(#{uid}-arrow{path.live ? '-live' : ''})" data-testid="workflow-edge" />
        {/each}
        {#each arcs as arc (arc.loop.to)}
          <path d={arc.d} class="loop {arc.loop.state}" marker-end="url(#{uid}-loop-{arc.loop.state})" data-testid="workflow-loop" data-state={arc.loop.state} />
        {/each}
      </svg>
      {#each arcs as arc (arc.loop.to)}
        <span class="loop-mark {arc.loop.state}" style:left="{arc.x}px" style:top="{arc.y}px" aria-hidden="true"><Repeat size={9} strokeWidth={2.25} /></span>
      {/each}
      {#each phases as phase, index (index)}
        <section class="phase" data-testid="workflow-phase">
          <p class="section-label">{fill(strings.workflow.phase, { n: String(index + 1) })}</p>
          <div class="steps">{#each phase as node (node.id)}{@render card(node)}{/each}</div>
        </section>
      {/each}
    </div>
  {:else}
    <div class="list">
      {#each phases as phase, index (index)}
        {#if index > 0}<span class="down" aria-hidden="true"><ArrowDown size={13} strokeWidth={1.75} /></span>{/if}
        <section class="phase" data-testid="workflow-phase">
          <p class="section-label">{fill(strings.workflow.phase, { n: String(index + 1) })}</p>
          <div class="steps">{#each phase as node (node.id)}{@render card(node)}{/each}</div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .graph { position: relative; min-width: 0; padding: 14px 16px 18px; overflow: auto; }
  .edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .edge { fill: none; stroke: color-mix(in srgb, var(--color-muted-foreground) 55%, transparent); stroke-width: 1.5; }
  .edge.live { stroke: color-mix(in srgb, var(--color-live) 70%, transparent); }
  .tip { fill: color-mix(in srgb, var(--color-muted-foreground) 55%, transparent); }
  .tip.live { fill: color-mix(in srgb, var(--color-live) 70%, transparent); }
  /* The label sits at the left of the gap an arrow crosses; an arrow leaves a card's center, at least half a card from that edge. */
  .rows { position: relative; display: flex; flex-direction: column; gap: 10px; }
  .rows.looped { padding-right: 8px; }
  /* A loop's arc: dashed, so it never reads as one more dependency; live while a round runs. */
  .loop { fill: none; stroke: color-mix(in srgb, var(--color-muted-foreground) 55%, transparent); stroke-width: 1.5; stroke-dasharray: 4 3; stroke-linecap: round; }
  .loop.live { stroke: color-mix(in srgb, var(--color-live) 75%, transparent); animation: pulse 1.6s var(--loop-ease-in-out-48) infinite var(--loops); }
  .loop.failed { stroke: color-mix(in srgb, var(--color-danger) 65%, transparent); }
  .loop.over { stroke: color-mix(in srgb, var(--color-success) 55%, transparent); }
  .loop-tip { fill: color-mix(in srgb, var(--color-muted-foreground) 55%, transparent); }
  .loop-tip.live { fill: color-mix(in srgb, var(--color-live) 75%, transparent); }
  .loop-tip.failed { fill: color-mix(in srgb, var(--color-danger) 65%, transparent); }
  .loop-tip.over { fill: color-mix(in srgb, var(--color-success) 55%, transparent); }
  .loop-mark { position: absolute; z-index: 1; width: 16px; height: 16px; display: grid; place-items: center; transform: translate(-50%, -50%); border: 1px solid var(--color-border); border-radius: var(--radius-full); background: var(--color-surface-2); color: var(--color-muted-foreground); pointer-events: none; }
  .loop-mark.live { border-color: color-mix(in srgb, var(--color-live) 55%, var(--color-border)); color: var(--color-live); }
  .loop-mark.failed { border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border)); color: var(--color-danger); }
  .loop-mark.over { color: var(--color-success); }
  .round { flex: none; display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px; border-radius: var(--radius-sm); background: var(--color-surface-3); color: var(--color-muted-foreground); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .round.live { background: color-mix(in srgb, var(--color-live) 16%, transparent); color: var(--color-live); }
  .round.failed { background: color-mix(in srgb, var(--color-danger) 14%, transparent); color: var(--color-danger); }
  .round.over { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
  @media (prefers-reduced-motion: reduce) { .loop.live { animation: none; } }
  :global(html[data-motion='reduced']) .loop.live { animation: none; }
  .phase { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .phase .section-label { margin: 0; }
  .rows .steps { display: flex; justify-content: center; gap: 12px; }
  .rows .node { flex: 1 1 0; min-width: 0; max-width: 320px; }
  .list { display: flex; flex-direction: column; }
  .list .steps { display: flex; flex-direction: column; gap: 8px; }
  .down { align-self: center; display: grid; place-items: center; height: 26px; color: var(--color-subtle); }
  .node { position: relative; width: 100%; height: auto; min-height: 0; padding: 9px 10px; display: flex; flex-direction: column; align-items: stretch; gap: 5px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-2); box-shadow: var(--shadow-e1); color: var(--color-foreground); text-align: left; font-weight: 400; transition: background var(--dur-2) var(--ease-out-quint), border-color var(--dur-2) var(--ease-out-quint); }
  .node:hover { background: color-mix(in srgb, var(--color-surface-2) 100%, var(--color-foreground) 4%); border-color: var(--color-edge); }
  .node:focus-visible { border-color: var(--color-edge); background: color-mix(in srgb, var(--color-surface-2) 100%, var(--color-foreground) 4%); }
  .node.selected { border-color: var(--color-foreground); }
  .node.running { border-color: color-mix(in srgb, var(--color-live) 45%, var(--color-border)); }
  .node.failed { border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border)); }
  .node.waiting, .node.skipped { background: var(--color-surface); box-shadow: none; }
  .node.skipped { border-style: dashed; color: var(--color-muted-foreground); }
  .head { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); font-weight: 500; }
  .count { flex: none; color: var(--color-muted-foreground); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .route { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .model { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .effort { flex: none; padding: 2px 5px; border-radius: var(--radius-sm); background: var(--color-surface-3); font-size: var(--text-xs); }
  .note { color: var(--color-subtle); font-size: var(--text-xs); }
  .metrics { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
  .bar { display: flex; gap: 2px; height: 4px; }
  .bar i { flex: 1; min-width: 3px; border-radius: 2px; background: var(--color-surface-3); }
  .bar i.running { background: var(--color-live); }
  .bar i.done { background: var(--color-success); }
  .bar i.failed { background: var(--color-danger); }
  .bar i.stopped { background: var(--color-muted-foreground); }
</style>
