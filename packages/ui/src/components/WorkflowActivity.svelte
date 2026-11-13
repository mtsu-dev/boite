<script lang="ts">
  import { Workflow } from '@lucide/svelte';
  import type { WorkflowRun } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { phasesOf, runProgress } from '../lib/workflow-view';
  import { workflowFailure } from '../lib/failure-cause';
  import ActivityCard from './ActivityCard.svelte';
  import StatusMark from './StatusMark.svelte';
  import { workflowTone } from '../lib/status-tone';

  /** A run grouped on one row of the chat where it started, like the subagents it runs: its name over its state, steps and one tick per phase, its time, and the way to its graph. A failed run says why under them. */
  let { store, run }: { store: Store; run: WorkflowRun } = $props();
  let steps = $derived(runProgress(run));
  let phases = $derived(phasesOf(run));

  function phaseStatus(index: number) {
    const nodes = phases[index] ?? [];
    if (nodes.some(node => node.status === 'failed')) return 'failed';
    if (nodes.some(node => node.status === 'running')) return 'running';
    if (nodes.some(node => node.status === 'stopped')) return 'stopped';
    if (nodes.every(node => node.status === 'skipped')) return 'skipped';
    if (nodes.every(node => node.status === 'done' || node.status === 'skipped')) return 'done';
    return 'waiting';
  }

  function open() {
    store.panel.openWorkflow(run.id);
  }
</script>

<ActivityCard live={run.status === 'running'} tone={run.status === 'done' ? 'done' : run.status === 'failed' ? 'failed' : undefined} heading={run.name} timing={{ startedAt: run.createdAt, finishedAt: run.finishedAt, active: run.status === 'running' }} onclick={open} data-testid="workflow-activity" data-run-id={run.id} data-status={run.status} title={strings.workflow.show}
  cause={run.status === 'failed' ? workflowFailure(run) : undefined}>
  {#snippet mark()}<Workflow size={15} strokeWidth={1.75} />{/snippet}
  {#snippet progress()}
    <StatusMark {...workflowTone(run.status, true)} />
    <span>{strings.workflow.status[run.status]} · {fill(strings.workflow.steps, { done: String(steps.done), total: String(steps.total) })}</span>
  {/snippet}
  {#snippet extra()}
    <span class="phases" aria-hidden="true">
      {#each phases as _, index (index)}<i class={phaseStatus(index)}></i>{/each}
    </span>
  {/snippet}
</ActivityCard>

<style>
  /* One tick per phase, read at a glance beside the step count; the one running breathes. */
  .phases { display: inline-flex; flex: none; gap: 3px; height: 6px; }
  .phases i { width: 18px; border-radius: var(--radius-full); background: color-mix(in oklab, var(--color-foreground) 14%, transparent); }
  .phases i.running { background: var(--color-live); animation: breathe 0.9s ease-in-out infinite alternate; }
  .phases i.done { background: var(--color-success); }
  .phases i.failed { background: var(--color-danger); }
  .phases i.stopped { background: var(--color-muted-foreground); }
  .phases i.skipped { background: transparent; border: 1px dashed var(--color-edge); }
  @media (prefers-reduced-motion: reduce) { .phases i.running { animation: none; } }
  @media (max-width: 720px) { .phases i { width: 12px; } }
</style>
