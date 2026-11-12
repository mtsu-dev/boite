<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import Spinner from './Spinner.svelte';
  import { machineAway } from '../lib/machine-away';
  import { inStrip } from '../lib/one-status';
  import { openAgent } from '../lib/open-agent';
  import { wordFit } from '../lib/word-fit';

  let { store, threadId, turn = false, shown = $bindable(false), held = 0, open = false, ontoggle }: {
    store: Store;
    threadId: string;
    /** The line also stops the turn, and shows with nothing sent ("Working"): a question holds the field's button. */
    turn?: boolean;
    /** The line is drawn: the strip folds the held prompts under it. */
    shown?: boolean;
    /** How many prompts wait to be sent, counted after the words ("Waiting on 3 subagents · 1 queued") and listed once it unfolds. */
    held?: number;
    /** Unfolded: one row per run under the line, the held prompts after them (`ComposerFoot`). */
    open?: boolean;
    ontoggle?: () => void;
  } = $props();
  /**
   * The strip's line above the composer while this thread waits on work it
   * sent (`ComposerFoot`): a spinner, "Waiting on 4 subagents" (and "· 1
   * queued"), their names in muted ink cut at a word, and a Stop at the right
   * that names what it stops. The same words on a desktop and a phone, where
   * the names are cut earlier. A tap unfolds one row per run, each opening
   * it, then the queued prompts. A persistent agent's memory pass is the
   * core's upkeep, not work it sent.
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
  let working = $derived(count === 0 ? strings.chat.working : !runs.length
    ? (agents === 1 ? strings.delegation.waitingOne : fill(strings.delegation.waiting, { count: String(agents) }))
    : !agents ? (runs.length === 1 ? strings.delegation.waitingWorkflowOne : fill(strings.delegation.waitingWorkflows, { count: String(runs.length) }))
    : fill(strings.delegation.waitingMixed, { count: String(count) }));
  // Its own box after the words, never cut: a narrow line cuts the words at one of theirs and keeps the queued count whole.
  let queued = $derived(held > 0 ? fill(strings.composer.stripQueued, { count: String(held) }) : '');
  let queuedAlone = $derived(held > 0 ? fill(strings.composer.stripQueuedAlone, { count: String(held) }) : '');
  /** Each run once, the way to its own view when it has one. */
  let items = $derived([
    ...active.map(agent => ({ id: agent.thread.id, name: agent.thread.title, open: () => openAgent(store, agent) })),
    ...native.map(agent => ({ id: agent.id, name: agent.name ?? agent.task ?? agent.id, open: null })),
    ...runs.map(run => ({ id: run.id, name: run.name, open: () => { store.panel.openWorkflow(run.id); } }))
  ]);
  let names = $derived(items.map(item => item.name).join(', '));

  // A provider's subagent ends with the turn that runs it; a command's agent follows its own process, which Stop never kills.
  let inTurn = $derived((turn || native.some(agent => agent.source !== 'process')) && store.openThread?.id === threadId);
  /** The machine is out of reach: the line is what it last ran, still, and nothing here can stop it. */
  let away = $derived(machineAway(store));
  let stoppable = $derived(!away && (active.length + runs.length > 0 || inTurn));
  /** Stop's words say its reach, its tooltip the rest: the turn alone, the turn and what it waits on, or only the work it sent. */
  let stopKey = $derived<'stopAgent' | 'stopAll' | 'stopSent' | 'stopSubagents' | 'stopWorkflows'>(inTurn ? (count ? 'stopAll' : 'stopAgent')
    : active.length && runs.length ? 'stopSent' : active.length ? 'stopSubagents' : 'stopWorkflows');

  let drawn = $derived(count > 0 || (turn && !away));
  $effect(() => { shown = drawn; });
  /** Something to unfold: the runs one per row, or the held prompts. */
  let foldable = $derived(!!ontoggle && (count > 0 || held > 0));

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

{#if drawn}
  <div class="foot-row waiting" data-testid="agent-dock" data-count={agents} data-runs={runs.length} data-named={names && !open ? '' : undefined} role="status">
    <span class="mark"><Spinner size={12} stale={away} /></span>
    {#if foldable}
      <button type="button" class="ghost fold" data-testid="composer-foot-fold" aria-expanded={open} title={open ? strings.composer.stripClose : strings.composer.stripOpen} onclick={ontoggle}>
        <span class="label ui-label" data-testid="agent-dock-label" data-text={working} use:wordFit={working}></span>
        {#if queued}<span class="queued ui-label" data-testid="agent-dock-queued">{queued}</span>{/if}
        <ChevronDown size={14} class={open ? 'turned' : ''} aria-hidden="true" />
      </button>
    {:else}
      <span class="label ui-label" data-testid="agent-dock-label" data-text={working} use:wordFit={working}></span>
      {#if queued}<span class="queued ui-label" data-testid="agent-dock-queued">{queued}</span>{/if}
    {/if}
    {#if !open}
      <!-- A phone's second line: the count leaves the first one, so the words stay whole; the one in the line above stays for a screen reader. -->
      {#if queued}<span class="queued-under" aria-hidden="true">{queuedAlone}</span>{/if}
      <span class="names" data-testid="agent-dock-names" title={names} use:wordFit={names}></span>
    {/if}
    {#if stoppable}
      <button type="button" class="small ghost stop" data-testid="agent-dock-stop" title={strings.composer[`${stopKey}Hint`]} disabled={stopping} onclick={() => void stop()}>
        <span class="stop-mark" aria-hidden="true"></span><span class="ui-label">{strings.composer[stopKey]}</span>
      </button>
    {/if}
  </div>
  {#if open && items.length}
    <ul class="runs" data-testid="agent-dock-rows">
      {#each items as item (item.id)}
        <li class="foot-row run">
          {#if item.open}
            <button type="button" class="ghost open" data-testid="agent-dock-row" title={item.name} onclick={item.open}><span class="words" use:wordFit={item.name}></span></button>
          {:else}<span class="open" data-testid="agent-dock-row" title={item.name}><span class="words" use:wordFit={item.name}></span></span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  /* The mark in the box every strip row gives its icon (`ComposerFoot`). */
  .waiting { color: var(--color-muted-foreground); }
  .mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; }
  /* Stop always fits: on a narrow row the label gives way first, cut between
     words (lib/word-fit.ts). The hidden whole label sizes the box, so a cut
     never shrinks it and the label comes back whole once there is room; its
     2 px cover the room word-fit keeps spare for canvas rounding. */
  .label { display: flex; flex-direction: column; flex: 0 1 auto; min-width: 0; overflow: hidden; }
  .label::before { content: attr(data-text); height: 0; padding-right: 2px; overflow: hidden; visibility: hidden; }
  .queued { flex: none; }
  .queued-under { display: none; }
  /* The names on one line in muted ink, cut at a word (lib/word-fit.ts): its
     width is what the counts and Stop leave, never its own words, so a phone
     cuts them earlier and drops them only when no word fits. */
  .names { display: block; flex: 1 1 0; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--color-subtle); }
  .stop { flex: none; margin-left: auto; gap: 5px; }
  /* The fold toggle: the line's own words, no frame, the chevron after them. */
  .fold { display: flex; align-items: center; gap: 6px; flex: 0 1 auto; min-width: 0; height: calc(var(--foot-row) - 4px); margin-left: -6px; padding: 0 6px; justify-content: flex-start; border: none; color: inherit; font: inherit; text-align: left; }
  .fold > :global(svg) { flex: none; color: var(--color-subtle); transition: transform var(--motion-duration) var(--motion-curve); }
  .fold > :global(svg.turned) { transform: rotate(180deg); }
  /* A media stop, the square in a ring, drawn here: a bare square reads as a checkbox, and an icon would weigh on the first load. */
  .stop-mark { position: relative; flex: none; width: 14px; height: 14px; border: 1.5px solid currentColor; border-radius: var(--radius-full); }
  .stop-mark::after { content: ''; position: absolute; inset: 3px; background: currentColor; }
  /* One row per run, its name under the line's words, a press opens it. */
  .runs { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
  .run { padding-left: 32px; }
  .open { display: flex; flex: 1 1 auto; min-width: 0; height: calc(var(--foot-row) - 4px); margin-left: -6px; padding: 0 6px; align-items: center; justify-content: flex-start; border: none; color: var(--color-muted-foreground); font: inherit; }
  /* The name takes the row's width, so word-fit cuts it to the row, not to its own cut. */
  .words { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-align: left; }
  /* A phone has no room for the words, the names and Stop on one line: the
     words keep the first line whole, the names take the second under them,
     cut earlier at a word, and Stop ends it at the right. */
  @media (max-width: 720px) {
    .foot-row.waiting[data-named] {
      display: grid;
      grid-template-columns: 16px auto minmax(0, 1fr) auto;
      grid-template-areas: 'mark label label label' '. queued names stop';
      height: auto;
    }
    .foot-row.waiting[data-named] > * { height: var(--foot-row); }
    .foot-row.waiting[data-named] > .mark { grid-area: mark; }
    .foot-row.waiting[data-named] > :is(.fold, .label) { grid-area: label; justify-self: start; max-width: 100%; }
    .foot-row.waiting[data-named] > .names { grid-area: names; line-height: var(--foot-row); }
    .foot-row.waiting[data-named] > .queued-under { display: block; grid-area: queued; margin-right: 4px; line-height: var(--foot-row); white-space: nowrap; }
    .foot-row.waiting[data-named] .queued { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .foot-row.waiting[data-named] > .stop { grid-area: stop; }
    .stop { position: relative; }
    .stop::after { content: ''; position: absolute; inset: -8px -2px; }
  }
</style>
