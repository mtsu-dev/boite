<script lang="ts">
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import Spinner from './Spinner.svelte';
  import { machineAway } from '../lib/machine-away';
  import { inStrip } from '../lib/one-status';
  import { wordFit } from '../lib/word-fit';

  let { store, threadId }: { store: Store; threadId: string } = $props();
  /**
   * The foot's quiet row above the composer while this thread waits on work it
   * sent (`ComposerFoot`): a spinner, "Waiting on 4 subagents", their names whole as far as
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
  /** The machine is out of reach: the line is what it last ran, still, and nothing here can stop it. */
  let away = $derived(machineAway(store));
  let stoppable = $derived(!away && (active.length + runs.length > 0 || inTurn));

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
  <div class="foot-row waiting" data-testid="agent-dock" data-count={agents} data-runs={runs.length} role="status">
    <span class="mark"><Spinner size={12} stale={away} /></span>
    <span class="label ui-label" data-testid="agent-dock-label" data-text={label} use:wordFit={label}></span>
    <span class="names" data-testid="agent-dock-names" title={names.join(', ')}>
      <span class="start" aria-hidden="true"></span>{' '}{#each names as name, index (index)}<span class="item">{index > 0 ? ', ' : ''}<span class="name">{name}</span></span>{/each}
    </span>
    {#if stoppable}
      <button type="button" class="small ghost stop" data-testid="agent-dock-stop" title={strings.delegation.waitingStopHint} disabled={stopping} onclick={() => void stop()}>
        <span class="stop-mark" aria-hidden="true"></span><span class="ui-label">{strings.delegation.waitingStop}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  /* The mark in the box every foot row gives its icon (`ComposerFoot`). */
  .waiting { color: var(--color-muted-foreground); }
  .mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; }
  /* Stop always fits: on a narrow row the label gives way first, cut between
     words (lib/word-fit.ts). The hidden whole label sizes the box, so a cut
     never shrinks it and the label comes back whole once there is room; its
     2 px cover the room word-fit keeps spare for canvas rounding. */
  .label { display: flex; flex-direction: column; flex: 0 1 auto; min-width: 0; overflow: hidden; }
  .label::before { content: attr(data-text); height: 0; padding-right: 2px; overflow: hidden; visibility: hidden; }
  /* Whole names on one line: a name that does not fit wraps to a second
     line the row hides, so the line ends between names, never inside one;
     the empty first box holds the first line, so even the first name goes
     whole or not at all. Its width comes from the row, never from its words.
     A name carries the comma before it, so the line never ends on one. */
  .names { display: block; flex: 1 1 0; min-width: 0; height: 20px; overflow: hidden; line-height: 20px; white-space: normal; color: var(--color-subtle); }
  .start { display: inline-block; width: 0; }
  .item { display: inline-block; white-space: nowrap; }
  .stop { flex: none; margin-left: auto; gap: 5px; }
  /* A media stop, the square in a ring, drawn here: a bare square reads as a checkbox, and an icon would weigh on the first load. */
  .stop-mark { position: relative; flex: none; width: 14px; height: 14px; border: 1.5px solid currentColor; border-radius: var(--radius-full); }
  .stop-mark::after { content: ''; position: absolute; inset: 3px; background: currentColor; }
  @media (max-width: 720px) { .stop { position: relative; } .stop::after { content: ''; position: absolute; inset: -8px -2px; } }
</style>
