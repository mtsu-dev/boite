<script lang="ts">
  import { Check, Square } from '@lucide/svelte';
  import type { DelegatedAgent } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { agentProgress, teamProgress } from '../lib/delegation-progress';
  import { openAgent } from '../lib/open-agent';
  import { agentFailure } from '../lib/failure-cause';
  import { wordFit } from '../lib/word-fit';
  import ActivityCard from './ActivityCard.svelte';
  import Elapsed from './Elapsed.svelte';
  import FailMark from './FailMark.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import Spinner from './Spinner.svelte';

  /**
   * The subagents one message started, grouped on one row where they
   * started: up to three provider marks then "+N", "4 subagents" over where
   * they stand ("2 working, 1 needs you, 1 done"), the time, a chevron. It
   * unfolds on one row per subagent, each opening its own conversation; a
   * failed one, or one whose work ended without reporting back (stopped, the
   * word Activity uses), says why in a muted line under its name.
   */
  let { store, agents }: { store: Store; agents: DelegatedAgent[] } = $props();
  const team = $derived(teamProgress(agents));

  type RowState = 'working' | 'asking' | 'done' | 'failed' | 'stopped';
  /** Asked something of the user: a question or a permission open in its conversation, or one its core reports by name. */
  let asking = $derived(new Set([
    ...agents.filter(agent => agent.needsInput?.length).map(agent => agent.thread.id),
    ...store.pendingQuestions.map(ask => ask.threadId),
    ...store.pendingPermissions.map(ask => ask.threadId),
    ...(agents[0]?.thread.parentThreadId ? store.subagentQuestions(agents[0].thread.parentThreadId).map(child => child.threadId) : [])
  ]));
  let rows = $derived(agents.map(agent => {
    const progress = agentProgress(agent);
    const state: RowState = progress.active ? (asking.has(agent.thread.id) ? 'asking' : 'working')
      : progress.status === 'done' ? 'done'
      : progress.status === 'error' ? 'failed'
      : 'stopped';
    // Work that ended without reporting back stopped there, as Activity says: its reason shows under the name.
    const cause = state === 'failed' || progress.status === 'interrupted' ? agentFailure(agent) : null;
    return { agent, progress, state, cause };
  }));
  let counts = $derived.by(() => {
    const of = (state: RowState) => rows.filter(row => row.state === state).length;
    const working = of('working'), asks = of('asking'), done = of('done'), failed = of('failed'), stopped = of('stopped');
    return [
      working ? fill(strings.delegation.countWorking, { count: String(working) }) : '',
      asks ? (asks === 1 ? strings.delegation.countAskingOne : fill(strings.delegation.countAsking, { count: String(asks) })) : '',
      done ? fill(strings.delegation.countDone, { count: String(done) }) : '',
      failed ? fill(strings.delegation.failed, { count: String(failed) }) : '',
      stopped ? fill(strings.delegation.stopped, { count: String(stopped) }) : ''
    ].filter(Boolean);
  });
  const MARKS = 3;
  let marks = $derived(agents.slice(0, MARKS));
  let more = $derived(agents.length - marks.length);

  let expanded = $state(false);
</script>

<ActivityCard live={team.active} heading={agents.length === 1 ? strings.delegation.groupOne : fill(strings.delegation.group, { count: String(agents.length) })}
  timing={team} {expanded} onclick={() => { expanded = !expanded; }} data-testid="delegation-activity" data-count={agents.length} progressTestId="delegation-progress">
  {#snippet mark()}
    <span class="stack">
      {#each marks as agent (agent.thread.id)}<span class="logo"><ProviderLogo providerId={agent.thread.providerId} size={13} /></span>{/each}
      {#if more > 0}<span class="more ui-label">+{more}</span>{/if}
    </span>
  {/snippet}
  {#snippet progress()}<span class="counts">{#each counts as count, index (count)}{#if index > 0}{', '}{/if}<span class="count">{count}</span>{/each}</span>{/snippet}
  <ul class="agents" data-testid="delegation-agents">
    {#each rows as row (row.agent.thread.id)}
      <li>
        <button type="button" class="ghost agent" data-testid="delegation-agent" data-state={row.state} title={row.agent.thread.title} onclick={() => openAgent(store, row.agent)}>
          <span class="glyph" aria-hidden="true"><ProviderLogo providerId={row.agent.thread.providerId} size={13} /></span>
          <span class="name">{row.agent.thread.title}</span>
          <span class="state" data-state={row.state} role="img" aria-label={strings.delegation.rowState[row.state]} title={strings.delegation.rowState[row.state]}>
            {#if row.state === 'working'}<Spinner size={11} />
            {:else if row.state === 'asking'}<span class="dot"></span>
            {:else if row.state === 'done'}<Check size={12} strokeWidth={2.25} />
            {:else if row.state === 'failed'}<FailMark size={14} />
            {:else}<Square size={9} fill="currentColor" />{/if}
          </span>
          <span class="timing"><Elapsed startedAt={row.progress.startedAt} finishedAt={row.progress.finishedAt} active={row.progress.active} /></span>
          {#if row.cause}<span class="cause" data-testid="delegation-agent-cause" title={row.cause} use:wordFit={row.cause}></span>{/if}
        </button>
      </li>
    {/each}
  </ul>
</ActivityCard>

<style>
  /* The marks overlap a little, each ringed in the page's ground so the next one reads apart. */
  .stack { display: inline-flex; align-items: center; }
  .logo { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: var(--radius-full); background: var(--color-surface-2); box-shadow: 0 0 0 1.5px var(--color-background); }
  .logo + .logo { margin-left: -5px; }
  /* A button keeps its words on one line: on a narrow column the counts wrap between two, never inside one or under the time. */
  .counts { min-width: 0; white-space: normal; }
  .count { white-space: nowrap; }
  .more { margin-left: 4px; color: var(--color-subtle); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .agents { display: flex; flex-direction: column; margin: 0; padding: 0 0 2px; list-style: none; }
  /* One row per subagent, under the group's marks: its provider, its name, its state, its time; a cause on a
     second line under all but the mark, so the name's column, narrowed by the state and the time, never holds it. */
  .agent { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; justify-content: stretch; gap: 0 var(--activity-gap); width: 100%; min-height: var(--control); height: auto; padding: var(--activity-padding); padding-left: calc(var(--activity-padding) + 6px); border-radius: var(--radius-sm); color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; text-align: left; }
  .agent:hover, .agent:focus-visible { background: var(--color-surface-2); color: var(--color-foreground); }
  .agent:active { transform: none; }
  .glyph { display: inline-flex; flex: none; justify-content: center; width: var(--activity-glyph); grid-row: 1 / span 2; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 18px; }
  /* The cause adds no width of its own (`contain`): it wraps to two lines, then ends on a whole word (`wordFit`), never widens the list past the screen.
     `normal`: the row is a button, whose words stay on one line, which would hold the cause to one. */
  .cause { grid-column: 2 / -1; grid-row: 2; white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; min-width: 0; contain: inline-size; overflow: hidden; overflow-wrap: anywhere; font-size: var(--text-xs); line-height: 16px; color: var(--color-muted-foreground); }
  .state { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; color: var(--color-subtle); }
  .state[data-state='done'] { color: var(--color-success); }
  .state[data-state='failed'] { color: var(--color-danger); }
  .dot { width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--color-live); }
  .timing { flex: none; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
</style>
