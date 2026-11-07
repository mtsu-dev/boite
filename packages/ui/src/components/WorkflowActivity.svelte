<script lang="ts">
  import { Workflow } from '@lucide/svelte';
  import type { WorkflowRun } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { phasesOf, runProgress } from '../lib/workflow-view';
  import ActivityCard from './ActivityCard.svelte';
  import StatusMark from './StatusMark.svelte';
  import { workflowTone } from '../lib/thread-state';

  /** A run as one row of the chat where it started: its name, its state, one tick per phase, and the way to its graph. */
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

<ActivityCard live={run.status === 'running'} heading={`${strings.workflow.card} · ${run.name}`} timing={{ startedAt: run.createdAt, finishedAt: run.finishedAt, active: run.status === 'running' }} onclick={open} data-testid="workflow-activity" data-run-id={run.id} data-status={run.status} title={strings.workflow.show}>
  {#snippet mark()}<Workflow size={15} strokeWidth={1.75} />{/snippet}
  {#snippet progress()}
    <!-- A running row has the spinner at its end; the mark says how a run ended. -->
    {#if run.status !== 'running'}<StatusMark {...workflowTone(run.status, true)} />{/if}
    <span class="ui-label">{strings.workflow.status[run.status]}</span>
    <span class="ui-label">· {fill(strings.workflow.steps, { done: String(steps.done), total: String(steps.total) })}</span>
  {/snippet}
  {#snippet extra()}
    <span class="phases" aria-hidden="true">
      {#each phases as _, index (index)}<i class={phaseStatus(index)}></i>{/each}
    </span>
  {/snippet}
</ActivityCard>

<style>
  /* One short tick per phase, read at a glance beside the step count. */
  .phases { display: inline-flex; flex: none; gap: 2px; height: 4px; }
  .phases i { width: 10px; border-radius: 2px; background: var(--color-surface-3); }
  .phases i.running { background: var(--color-live); }
  .phases i.done { background: var(--color-success); }
  .phases i.failed { background: var(--color-danger); }
  .phases i.stopped { background: var(--color-muted-foreground); }
  .phases i.skipped { background: transparent; border: 1px dashed var(--color-edge); }
</style>
