<script lang="ts">
  import { ChevronDown, Workflow } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import Elapsed from './Elapsed.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import Spinner from './Spinner.svelte';
  import { machineAway } from '../lib/machine-away';
  import { inStrip } from '../lib/one-status';
  import { openAgent } from '../lib/open-agent';
  import { wordFit } from '../lib/word-fit';

  let { store, threadId, turn = false, open = false, ontoggle }: {
    store: Store;
    threadId: string;
    /** The line also stops the turn, and shows with nothing sent ("Working"): a question holds the field's button. */
    turn?: boolean;
    /** Unfolded: one row per run under the line (`ComposerFoot`). */
    open?: boolean;
    ontoggle?: () => void;
  } = $props();
  /**
   * The strip's line above the composer while this thread waits on work it
   * sent (`ComposerFoot`): one framed pill, a spinner, the model mark of each
   * subagent (their names in its tooltip), "Waiting on 4 subagents", how long
   * the oldest has run, and a Stop at the line's right that names what it
   * stops. The same on a desktop and a phone. A tap unfolds one row per run,
   * its mark, its name and its time, each opening it. A persistent agent's
   * memory pass is the core's upkeep, not work it sent.
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
  /** Each run once, the way to its own view when it has one. */
  // A provider's own subagent runs on the thread's provider; a workflow has no model of its own (`provider: null`, its glyph).
  let own = $derived(store.threads.find(row => row.id === threadId)?.providerId ?? store.openThread?.providerId ?? null);
  let items = $derived([
    ...active.map(agent => ({ id: agent.thread.id, name: agent.thread.title, provider: agent.thread.providerId as string | null, since: agent.lastTurn?.startedAt ?? agent.lastTurn?.queuedAt ?? agent.thread.createdAt, open: (() => openAgent(store, agent)) as (() => void) | null })),
    ...native.map(agent => ({ id: agent.id, name: agent.name ?? agent.task ?? agent.id, provider: own as string | null, since: agent.startedAt, open: null })),
    ...runs.map(run => ({ id: run.id, name: run.name, provider: null, since: run.createdAt, open: () => { store.panel.openWorkflow(run.id); } }))
  ]);
  let names = $derived(items.map(item => item.name).join(', '));
  /** The marks the pill holds before "+N". */
  const MARKS = 5;
  let marks = $derived(items.slice(0, MARKS));
  let since = $derived(items.length ? Math.min(...items.map(item => item.since)) : null);

  // A provider's subagent ends with the turn that runs it; a command's agent follows its own process, which Stop never kills.
  let inTurn = $derived((turn || native.some(agent => agent.source !== 'process')) && store.openThread?.id === threadId);
  /** The machine is out of reach: the line is what it last ran, still, and nothing here can stop it. */
  let away = $derived(machineAway(store));
  let stoppable = $derived(!away && (active.length + runs.length > 0 || inTurn));
  /** Stop's words say its reach, its tooltip the rest: the turn alone, the turn and what it waits on, or only the work it sent. */
  let stopKey = $derived<'stopAgent' | 'stopAll' | 'stopSent' | 'stopSubagents' | 'stopWorkflows'>(inTurn ? (count ? 'stopAll' : 'stopAgent')
    : active.length && runs.length ? 'stopSent' : active.length ? 'stopSubagents' : 'stopWorkflows');

  let drawn = $derived(count > 0 || (turn && !away));
  /** Something to unfold: the runs one per row. */
  let foldable = $derived(!!ontoggle && count > 0);

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

{#snippet words()}
  <span class="spin"><Spinner size={12} stale={away} /></span>
  {#if !open && marks.length}
    <span class="marks" data-testid="agent-dock-names" title={names}>{#each marks as item (item.id)}<span class="logo" aria-hidden="true">{#if item.provider}<ProviderLogo providerId={item.provider} size={13} />{:else}<Workflow size={12} strokeWidth={1.75} />{/if}</span>{/each}{#if items.length > marks.length}<span class="more ui-label" aria-hidden="true">+{items.length - marks.length}</span>{/if}<span class="visually-hidden">{names}</span></span>
  {/if}
  <span class="label ui-label" data-testid="agent-dock-label" data-text={working} use:wordFit={working}></span>
  {#if since !== null && !away}<span class="since" aria-hidden="true">·</span><span class="since"><Elapsed startedAt={since} finishedAt={null} active /></span>{/if}
{/snippet}

{#if drawn}
  <div class="foot-row waiting" data-testid="agent-dock" data-count={agents} data-runs={runs.length} role="status">
    {#if foldable}
      <button type="button" class="ghost pill fold" data-testid="composer-foot-fold" aria-expanded={open} title={open ? strings.composer.stripClose : strings.composer.stripOpen} onclick={ontoggle}>
        {@render words()}
        <ChevronDown size={14} class={open ? 'chevron turned' : 'chevron'} aria-hidden="true" />
      </button>
    {:else}
      <span class="pill" class:bare={count === 0}>{@render words()}</span>
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
            <button type="button" class="ghost open" data-testid="agent-dock-row" title={item.name} onclick={item.open}><span class="logo" aria-hidden="true">{#if item.provider}<ProviderLogo providerId={item.provider} size={13} />{:else}<Workflow size={12} strokeWidth={1.75} />{/if}</span><span class="words" use:wordFit={item.name}></span><span class="since"><Elapsed startedAt={item.since} finishedAt={null} active={!away} /></span></button>
          {:else}<span class="open" data-testid="agent-dock-row" title={item.name}><span class="logo" aria-hidden="true">{#if item.provider}<ProviderLogo providerId={item.provider} size={13} />{:else}<Workflow size={12} strokeWidth={1.75} />{/if}</span><span class="words" use:wordFit={item.name}></span><span class="since"><Elapsed startedAt={item.since} finishedAt={null} active={!away} /></span></span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  /* The line stands a little taller than the strip's other rows: it holds a framed pill. */
  div.foot-row.waiting { height: auto; min-height: calc(var(--foot-row) + 8px); padding-left: 0; color: var(--color-muted-foreground); }
  /* The pill: one framed button on the page's ground, the line's words in the foreground ink, small. */
  .pill { display: inline-flex; align-items: center; gap: 7px; flex: 0 1 auto; min-width: 0; height: var(--control); padding: 0 10px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-foreground); font: inherit; font-size: var(--text-sm); text-align: left; }
  button.pill { justify-content: flex-start; transition: background var(--motion-duration) var(--motion-curve), border-color var(--motion-duration) var(--motion-curve); }
  @media (hover: hover) { button.pill:hover { border-color: var(--color-edge); background: var(--color-surface-2); } }
  /* A turn alone ("Working"): nothing to open, so no frame. */
  .pill.bare { padding: 0 2px 0 14px; border-color: transparent; background: none; color: inherit; }
  .spin { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 14px; }
  /* Each subagent's model mark, ringed in the pill's ground so the next one reads apart. */
  .marks { display: inline-flex; align-items: center; flex: none; }
  .logo { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 20px; height: 20px; border-radius: var(--radius-full); background: var(--color-surface-3); box-shadow: 0 0 0 1.5px var(--color-surface); color: var(--color-muted-foreground); }
  .marks .logo + .logo { margin-left: -5px; }
  .more { margin-left: 4px; color: var(--color-subtle); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  /* Stop always fits: on a narrow row the label gives way first, cut between
     words (lib/word-fit.ts). The hidden whole label sizes the box, so a cut
     never shrinks it and the label comes back whole once there is room; its
     2 px cover the room word-fit keeps spare for canvas rounding. */
  .label { display: flex; flex-direction: column; flex: 0 1 auto; min-width: 0; overflow: hidden; font-weight: 500; }
  .label::before { content: attr(data-text); height: 0; padding-right: 2px; overflow: hidden; visibility: hidden; }
  .since { flex: none; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  .stop { flex: none; margin-left: auto; gap: 5px; }
  .pill > :global(svg.chevron) { flex: none; color: var(--color-subtle); transition: transform var(--motion-duration) var(--motion-curve); }
  .pill > :global(svg.turned) { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { button.pill, .pill > :global(svg.chevron) { transition: none; } }
  /* A media stop, the square in a ring, drawn here: a bare square reads as a checkbox, and an icon would weigh on the first load. */
  .stop-mark { position: relative; flex: none; width: 14px; height: 14px; border: 1.5px solid currentColor; border-radius: var(--radius-full); }
  .stop-mark::after { content: ''; position: absolute; inset: 3px; background: currentColor; }
  /* One row per run under the pill: its model mark, its name, its time; a press opens it. */
  .runs { display: flex; flex-direction: column; margin: 0; padding: 0 0 4px; list-style: none; }
  li.foot-row.run { height: auto; padding-left: 4px; }
  .open { display: flex; flex: 1 1 auto; gap: 8px; min-width: 0; height: var(--control); padding: 0 8px; align-items: center; justify-content: flex-start; border: none; border-radius: var(--radius-sm); color: var(--color-muted-foreground); font: inherit; }
  .open .logo { box-shadow: none; }
  @media (hover: hover) { button.open:hover { background: var(--color-surface-2); color: var(--color-foreground); } }
  /* The name takes the row's width, so word-fit cuts it to the row, not to its own cut. */
  .words { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-align: left; }
  @media (max-width: 720px) {
    .pill:not(.bare) { height: 36px; }
    /* A phone keeps the words whole: Stop takes a line of its own under a pill too long to share one, and the time is on each row once unfolded. */
    div.foot-row.waiting { flex-wrap: wrap; row-gap: 2px; }
    .pill:has(.marks) > .spin { display: none; }
    .pill > .since { display: none; }
    .pill.bare { padding-left: 12px; }
    .open { height: 40px; }
    .stop { position: relative; }
    .stop::after { content: ''; position: absolute; inset: -8px -2px; }
  }
</style>
