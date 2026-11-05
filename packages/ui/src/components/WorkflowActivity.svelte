<script lang="ts">
  import type { WorkflowRun } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { runProgress } from '../lib/workflow-view';
  import ActivityCard from './ActivityCard.svelte';

  /** A run in the chat where it started: its name and steps on one line, and the way to its graph. */
  let { store, run }: { store: Store; run: WorkflowRun } = $props();
  let steps = $derived(runProgress(run));
  // Only an outcome the steps do not tell is written out: a failure or a stop.
  let outcome = $derived(run.status === 'failed' || run.status === 'stopped' ? strings.workflow.status[run.status] : null);

  function open() {
    store.panel.openWorkflow(run.id);
  }
</script>

<ActivityCard live={run.status === 'running'} heading={`${strings.workflow.card} · ${run.name}`} timing={{ startedAt: run.createdAt, finishedAt: run.finishedAt, active: run.status === 'running' }} onclick={open} data-testid="workflow-activity" data-run-id={run.id} data-status={run.status} title={strings.workflow.show}>
  {#snippet progress()}
    <span class="ui-label">· {fill(strings.workflow.steps, { done: String(steps.done), total: String(steps.total) })}</span>
    {#if outcome}<span class="ui-label" class:failed={run.status === 'failed'}>· {outcome}</span>{/if}
  {/snippet}
</ActivityCard>

<style>
  .failed { color: var(--color-danger); }
</style>
