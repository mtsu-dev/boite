<script lang="ts">
  import { ChevronRight, Plus } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import EmptyState from './EmptyState.svelte';
  import ProviderLogo from './ProviderLogo.svelte';

  /**
   * The first screen of a machine with no AI, desktop and phone alike: the
   * house bot, one line, then the path in three numbered steps (round 17: a
   * list of agents alone left a first-time user without a next step). The
   * first step, the one to take now, is filled and holds the agents as rows,
   * each one the button that connects it, and a last row for the whole list;
   * the folder and the task wait under it, named so the way ahead is in
   * sight. A paired device is told where to connect one.
   */
  let { store }: { store: Store } = $props();

  /** The two services most people already pay for, then whatever else this machine already has. */
  const FEATURED = ['claude', 'codex'];
  const ROWS = 4;
  let agents = $derived.by(() => {
    const offered = store.offeredProviders;
    const featured = FEATURED.flatMap((id) => offered.filter((provider) => provider.id === id));
    return [...featured, ...offered.filter((provider) => !FEATURED.includes(provider.id) && provider.available)].slice(0, ROWS);
  });

  function planOf(id: string, name: string): string {
    const plans = strings.connect.plan as Record<string, string>;
    return plans[id] ?? fill(strings.connect.otherPlan, { provider: name });
  }
</script>

<EmptyState line={strings.firstRun.welcome} testid="first-run" markTestid="first-run-mark">
  {#snippet action()}
    {#if store.owner}
      <ol class="steps" aria-label={strings.firstRun.steps} data-testid="first-run-steps">
        <li class="step now" aria-current="step"><span class="number" aria-hidden="true">1</span><span class="ui-label">{strings.firstRun.stepConnect}</span></li>
        <li class="rows">
      <div class="agents" role="group" aria-label={strings.firstRun.agents}>
        {#each agents as agent (agent.id)}
          <button type="button" class="ghost agent" data-testid="first-run-agent" data-provider={agent.id} onclick={() => store.openConnect(agent.id)}>
            <span class="logo"><ProviderLogo providerId={agent.id} size={22} /></span>
            <span class="text">
              <span class="name">{agent.name}</span>
              <span class="plan">{planOf(agent.id, agent.name)}</span>
            </span>
            {#if agent.available}<span class="found ui-label">{strings.firstRun.installed}</span>{/if}
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        {/each}
        <!-- Every other agent: the connect dialog's whole list. -->
        <button type="button" class="ghost agent" data-testid="first-run-connect" onclick={() => store.openConnect(null)}>
          <span class="logo"><Plus size={18} strokeWidth={1.75} aria-hidden="true" /></span>
          <span class="text"><span class="name">{strings.firstRun.others}</span></span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
        </li>
        <li class="step"><span class="number" aria-hidden="true">2</span><span class="ui-label">{strings.firstRun.stepProject}</span></li>
        <li class="step"><span class="number" aria-hidden="true">3</span><span class="ui-label">{strings.firstRun.stepTask}</span></li>
      </ol>
      <button type="button" class="ghost small other" data-testid="first-run-other-machine" onclick={() => store.showSettings('machines')}>{strings.firstRun.otherMachine}</button>
    {:else}
      <p data-testid="first-run-device">{strings.connect.device}</p>
    {/if}
  {/snippet}
</EmptyState>

<style>
  .steps { display: flex; flex-direction: column; gap: var(--space-2); width: min(360px, calc(100vw - 2 * var(--space-6))); margin: 0; padding: 0; list-style: none; text-align: left; }
  .step { display: flex; align-items: center; gap: var(--space-3); min-height: 28px; color: var(--color-muted-foreground); font-size: var(--text-base); }
  /* The step to take now: its number filled in the ink, its words at full strength; the next ones an outline. */
  .number { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--color-edge); font-size: var(--text-sm); font-weight: 600; font-variant-numeric: tabular-nums; }
  .now { color: var(--color-foreground); font-weight: 600; }
  .now .number { background: var(--color-foreground); box-shadow: none; color: var(--color-on-foreground); }
  /* The rows hang off the first step, under its words. */
  .rows { margin: 0 0 var(--space-2); }
  .agents { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 4px; border-radius: var(--radius-lg); background: var(--color-surface-2); text-align: left; }
  .agent { width: 100%; height: auto; min-height: 52px; justify-content: flex-start; gap: var(--space-3); padding: 8px 10px; border-radius: var(--radius-md); text-align: left; color: var(--color-foreground); }
  .logo { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--color-surface-3); color: var(--color-muted-foreground); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; line-height: 1.3; }
  .name { font-weight: 600; color: var(--color-foreground); }
  .plan { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .found { flex: none; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .agent > :global(svg) { flex: none; color: var(--color-subtle); }
  .other { margin-top: var(--space-1); }
  @media (max-width: 720px) {
    .agent { min-height: var(--touch-target); }
  }
</style>
