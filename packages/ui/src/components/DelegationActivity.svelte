<script lang="ts">
  import type { DelegatedAgent } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { clockTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { teamProgress } from '../lib/delegation-progress';
  import ActivityCard from './ActivityCard.svelte';

  /**
   * The subagents one message started, on one line: how many, how far, and
   * the way to the Subagents surface. While one still runs, every line keeps
   * its progress words, under an older turn too: they are what ties the line's
   * count to the strip's and the panel's (a bare "started" left "4 subagents"
   * beside a "3" with nothing between them). Under an older turn the start
   * time moves to the line's title. Once none runs every line reads as their
   * record, how each one ended.
   */
  let { store, agents, past = false }: { store: Store; agents: DelegatedAgent[]; past?: boolean } = $props();
  const team = $derived(teamProgress(agents));
  const ended = (count: number, one: string, many: string) => count === 1 ? one : fill(many, { count: String(count) });
  /** Under an older turn the start leaves the line for its title. */
  const olderStart = $derived(team.active && past && team.startedAt !== null ? fill(strings.delegation.startedAt, { time: clockTime(team.startedAt) }) : null);
</script>

<ActivityCard live={team.active} heading={agents.length === 1 ? strings.chat.strip.subagentOne : fill(strings.chat.strip.subagentMany, { count: String(agents.length) })} timing={team.active && past ? { ...team, startedAt: null } : team} onclick={() => store.showTeam()} data-testid="delegation-activity" data-past={past || undefined} progressTestId="delegation-progress" title={olderStart ? `${strings.delegation.showTeam} · ${olderStart}` : strings.delegation.showTeam}>
  {#snippet progress()}
    {#if team.active}
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
