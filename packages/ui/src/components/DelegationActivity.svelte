<script lang="ts">
  import type { DelegatedAgent } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { teamProgress } from '../lib/delegation-progress';
  import ActivityCard from './ActivityCard.svelte';

  /** The subagents one message started, on one line: how many, how far, and the way to the Subagents surface. */
  let { store, agents }: { store: Store; agents: DelegatedAgent[] } = $props();
  const team = $derived(teamProgress(agents));
</script>

<ActivityCard live={team.active} heading={agents.length === 1 ? strings.chat.strip.subagentOne : fill(strings.chat.strip.subagentMany, { count: String(agents.length) })} timing={team} onclick={() => store.showTeam()} data-testid="delegation-activity" progressTestId="delegation-progress" title={strings.delegation.showTeam}>
  {#snippet progress()}
    <span class="ui-label">· {fill(strings.delegation.completed, { done: String(team.completed), total: String(agents.length) })}</span>
    {#if team.failed}<span class="failed ui-label">· {fill(strings.delegation.failed, { count: String(team.failed) })}</span>{/if}
    {#if team.stopped}<span class="ui-label">· {fill(strings.delegation.stopped, { count: String(team.stopped) })}</span>{/if}
    {#if team.interrupted}<span class="failed ui-label">· {fill(strings.delegation.interrupted, { count: String(team.interrupted) })}</span>{/if}
  {/snippet}
</ActivityCard>

<style>
  .failed { color: var(--color-danger); }
</style>
