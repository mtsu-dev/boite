<script lang="ts">
  import type { DelegatedAgent } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { clockTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { teamProgress } from '../lib/delegation-progress';
  import ActivityCard from './ActivityCard.svelte';

  /**
   * The subagents one message started, on one line: how many, how far, and
   * the way to the Subagents surface. The live count is the status strip's:
   * on the newest turn the line keeps it while one still runs, under an older
   * turn it says only when they started, and once none runs every line reads
   * as their record, how each one ended.
   */
  let { store, agents, past = false }: { store: Store; agents: DelegatedAgent[]; past?: boolean } = $props();
  const team = $derived(teamProgress(agents));
  const ended = (count: number, one: string, many: string) => count === 1 ? one : fill(many, { count: String(count) });
</script>

<ActivityCard live={team.active} heading={agents.length === 1 ? strings.chat.strip.subagentOne : fill(strings.chat.strip.subagentMany, { count: String(agents.length) })} timing={team.active && past ? { ...team, startedAt: null } : team} onclick={() => store.showTeam()} data-testid="delegation-activity" data-past={past || undefined} progressTestId="delegation-progress" stack={team.active && past} title={strings.delegation.showTeam}>
  {#snippet progress()}
    {#if team.active && past}
      {#if team.startedAt !== null}<span class="ui-label" data-testid="activity-started"><span class="sep">·</span> {fill(strings.delegation.startedAt, { time: clockTime(team.startedAt) })}</span>{/if}
    {:else if team.active}
      <span class="ui-label">· {fill(strings.delegation.completed, { done: String(team.completed), total: String(agents.length) })}</span>
      {#if team.failed}<span class="failed ui-label">· {fill(strings.delegation.failed, { count: String(team.failed) })}</span>{/if}
      {#if team.stopped}<span class="ui-label">· {fill(strings.delegation.stopped, { count: String(team.stopped) })}</span>{/if}
      {#if team.interrupted}<span class="failed ui-label">· {fill(strings.delegation.interrupted, { count: String(team.interrupted) })}</span>{/if}
    {:else}
      {#if team.completed}<span class="ui-label">· {ended(team.completed, strings.delegation.completedOne, strings.delegation.completedMany)}</span>{/if}
      {#if team.failed}<span class="failed ui-label">· {fill(strings.delegation.failed, { count: String(team.failed) })}</span>{/if}
      {#if team.stopped}<span class="ui-label">· {ended(team.stopped, strings.delegation.stoppedOne, strings.delegation.stopped)}</span>{/if}
      {#if team.interrupted}<span class="failed ui-label">· {ended(team.interrupted, strings.delegation.interruptedOne, strings.delegation.interrupted)}</span>{/if}
    {/if}
  {/snippet}
</ActivityCard>

<style>
  .failed { color: var(--color-danger); }
</style>
