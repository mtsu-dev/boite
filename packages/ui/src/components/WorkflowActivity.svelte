<script lang="ts">
  import type { WorkflowRun } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { clockTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { runProgress } from '../lib/workflow-view';
  import ActivityCard from './ActivityCard.svelte';

  /**
   * A run in the chat where it started: its name and steps on one line, and
   * the way to its graph. The live count is the status strip's: on the newest
   * turn the line keeps it while the run goes on, under an older turn the line
   * says only that it started and when, and once the run ended every line
   * reads as its record, the steps it finished.
   */
  let { store, run, past = false }: { store: Store; run: WorkflowRun; past?: boolean } = $props();
  let steps = $derived(runProgress(run));
  let going = $derived(run.status === 'running' || run.status === 'paused');
  // Only an outcome the steps do not tell is written out: a failure or a stop.
  let outcome = $derived(run.status === 'failed' || run.status === 'stopped' ? strings.workflow.status[run.status] : null);

  function open() {
    store.panel.openWorkflow(run.id);
  }
</script>

<ActivityCard live={run.status === 'running'} heading={`${strings.workflow.card} · ${run.name}`} timing={{ startedAt: going && past ? null : run.createdAt, finishedAt: run.finishedAt, active: going }} onclick={open} data-testid="workflow-activity" data-run-id={run.id} data-status={run.status} data-past={past || undefined} stack={going && past} title={strings.workflow.show}>
  {#snippet progress()}
    {#if going && past}
      <span class="ui-label" data-testid="activity-started"><span class="sep">·</span> {fill(strings.delegation.startedAt, { time: clockTime(run.createdAt) })}</span>
    {:else if going}
      <span class="ui-label">· {fill(strings.workflow.steps, { done: String(steps.done), total: String(steps.total) })}</span>
    {:else}
      <span class="ui-label">· {fill(strings.workflow.stepsDone, { done: String(steps.done), total: String(steps.total) })}</span>
      {#if outcome}<span class="ui-label" class:failed={run.status === 'failed'}>· {outcome}</span>{/if}
    {/if}
  {/snippet}
</ActivityCard>

<style>
  .failed { color: var(--color-danger); }
</style>
