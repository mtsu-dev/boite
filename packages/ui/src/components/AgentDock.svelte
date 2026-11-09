<script lang="ts">
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import Spinner from './Spinner.svelte';
  import { inStrip } from '../lib/one-status';

  let { store, threadId }: { store: Store; threadId: string } = $props();
  /**
   * The quiet line above the composer while this thread waits on work it
   * sent: a spinner, "Waiting on 4 subagents", their names whole as far as
   * they fit, and Stop. Each one is a row of the grouped line in the timeline, where it
   * started (`DelegationActivity`, `WorkflowActivity`), which opens it. A
   * persistent agent's memory pass is the core's upkeep, not work it sent.
   */
  // The team and the runs are the root conversation's: a subagent's own line counts only the ones it sent, never itself, its siblings or the root's runs.
  let root = $derived((store.delegation?.rootThreadId ?? threadId) === threadId);
  let active = $derived((store.delegation?.agents ?? []).filter(agent => inStrip(store, agent) && (root || agent.thread.parentThreadId === threadId)));
  // A provider's own subagents and a command's agents: they are waited on too.
  let native = $derived(root ? (store.delegation?.nativeAgents ?? []).filter(agent => agent.status === 'running') : []);
  let runs = $derived(store.workflowsOf(threadId).filter(run => run.status === 'running' && run.rootThreadId === threadId));

  $effect(() => { void store.loadDelegation(threadId); });
  $effect(() => { void store.loadWorkflows(threadId); });

  let agents = $derived(active.length + native.length);
  let count = $derived(agents + runs.length);
  let label = $derived(!runs.length
    ? (agents === 1 ? strings.delegation.waitingOne : fill(strings.delegation.waiting, { count: String(agents) }))
    : !agents ? (runs.length === 1 ? strings.delegation.waitingWorkflowOne : fill(strings.delegation.waitingWorkflows, { count: String(runs.length) }))
    : fill(strings.delegation.waitingMixed, { count: String(count) }));
  let names = $derived([...active.map(agent => agent.thread.title), ...native.map(agent => agent.name ?? agent.task ?? agent.id), ...runs.map(run => run.name)]);

  // A provider's subagent ends with the turn that runs it; a command's agent follows its own process, which Stop never kills.
  let inTurn = $derived(native.some(agent => agent.source !== 'process') && store.openThread?.id === threadId);
  let stoppable = $derived(active.length + runs.length > 0 || inTurn);

  /** Stops what the line waits on: the subagents this thread sent, its running workflows, and the turn that runs a provider's own. */
  let stopping = $state(false);
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    try {
      await Promise.all([
        ...(root ? (active.length ? [store.stopDelegatedAgent()] : []) : active.map(agent => store.stopDelegatedAgent(agent.thread.id))),
        ...runs.map(run => store.controlWorkflow(run, 'stop')),
        ...(inTurn ? [store.stop()] : [])
      ]);
    } finally { stopping = false; }
  }
</script>

{#if count > 0}
  <div class="waiting" data-testid="agent-dock" data-count={agents} data-runs={runs.length} role="status">
    <span class="mark"><Spinner size={11} /></span>
    <span class="label ui-label" data-testid="agent-dock-label">{label}</span>
    <span class="names" data-testid="agent-dock-names" title={names.join(', ')}>
      <span class="start" aria-hidden="true"></span>{#each names as name, index (index)}{' '}<span class="name">{name}{index < names.length - 1 ? ',' : ''}</span>{/each}
    </span>
    {#if stoppable}
      <button type="button" class="stop" data-testid="agent-dock-stop" title={strings.delegation.waitingStopHint} disabled={stopping} onclick={() => void stop()}>
        <span class="ui-label">{strings.delegation.waitingStop}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  /* Outside the card, on the conversation's ground: one quiet line in the
     composer's width, the mark in the box every dock row gives its icon. */
  .waiting { display: flex; align-items: center; gap: 8px; width: 100%; max-width: var(--content); min-width: 0; min-height: var(--dock-row, 28px); margin: 0 auto; padding: 0 12px; color: var(--color-muted-foreground); font-size: var(--text-meta); }
  .mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--dock-icon, 16px); }
  .label { flex: none; white-space: nowrap; }
  /* Whole names on one line: a name that does not fit wraps to a second
     line the row hides, so the line ends between names, never inside one;
     the empty first box holds the first line, so even the first name goes
     whole or not at all. Its width comes from the row, never from its words. */
  .names { display: block; flex: 1 1 0; min-width: 0; height: 20px; overflow: hidden; line-height: 20px; color: var(--color-subtle); }
  .start { display: inline-block; width: 0; }
  .name { display: inline-block; white-space: nowrap; }
  .stop { flex: none; min-height: var(--dock-row, 28px); height: auto; padding: 0 6px; border: none; background: transparent; box-shadow: none; color: var(--color-foreground); font-size: var(--text-meta); }
  .stop:hover:not(:disabled) { background: var(--color-hover); }
  @media (max-width: 720px) { .waiting { padding: 0 6px; } }
</style>
