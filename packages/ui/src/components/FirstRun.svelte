<script lang="ts">
  import { Check } from '@lucide/svelte';
  import type { ProviderId } from '@boite/contracts';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import EmptyState from './EmptyState.svelte';
  import ProviderLogo from './ProviderLogo.svelte';

  /**
   * The first screen of a machine with no AI, desktop and phone alike: the
   * house bot, one line, the agents to pick from as rows, one action. The
   * folder, the drafts and the composer come once an AI answers; a paired
   * device is told where to connect one.
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
  /** The picked row; an installed agent is picked from the start, else the action opens the whole list. */
  let picked = $state<ProviderId | null>(null);
  let chosen = $derived(agents.find((agent) => agent.id === picked) ?? agents.find((agent) => agent.available) ?? null);

  function planOf(id: string, name: string): string {
    const plans = strings.connect.plan as Record<string, string>;
    return plans[id] ?? fill(strings.connect.otherPlan, { provider: name });
  }

  /** Arrow keys move the choice along the rows, as in any radio group. */
  function onkeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || agents.length === 0) return;
    event.preventDefault();
    const at = chosen ? agents.indexOf(chosen) : -1;
    const next = agents[(at + step + agents.length) % agents.length]!;
    picked = next.id;
    (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-provider="${next.id}"]`)?.focus();
  }
</script>

<EmptyState line={strings.firstRun.welcome} testid="first-run" markTestid="first-run-mark">
  {#snippet action()}
    {#if store.owner}
      {#if agents.length > 0}
        <div class="agents" role="radiogroup" aria-label={strings.firstRun.agents} tabindex="-1" {onkeydown}>
          {#each agents as agent, index (agent.id)}
            {@const on = chosen?.id === agent.id}
            <button
              type="button"
              class="ghost agent"
              role="radio"
              aria-checked={on}
              tabindex={on || (!chosen && index === 0) ? 0 : -1}
              data-testid="first-run-agent"
              data-provider={agent.id}
              onclick={() => (picked = agent.id)}
            >
              <span class="logo"><ProviderLogo providerId={agent.id} size={22} /></span>
              <span class="text">
                <span class="name">{agent.name}</span>
                <span class="plan">{planOf(agent.id, agent.name)}</span>
              </span>
              {#if agent.available}<span class="found ui-label">{strings.firstRun.installed}</span>{/if}
              <span class="mark" aria-hidden="true">{#if on}<Check size={14} strokeWidth={2.5} />{/if}</span>
            </button>
          {/each}
        </div>
      {/if}
      <button type="button" class="primary start" data-testid="first-run-connect" onclick={() => store.openConnect(chosen?.id ?? null)}>
        {chosen ? fill(strings.firstRun.go, { provider: chosen.name }) : strings.connect.button}
      </button>
      <button type="button" class="ghost small other" data-testid="first-run-other-machine" onclick={() => store.showSettings('machines')}>{strings.firstRun.otherMachine}</button>
    {:else}
      <p data-testid="first-run-device">{strings.connect.device}</p>
    {/if}
  {/snippet}
</EmptyState>

<style>
  .agents { display: flex; flex-direction: column; gap: 2px; width: min(360px, calc(100vw - 2 * var(--space-6))); margin-bottom: var(--space-2); padding: 4px; border-radius: var(--radius-lg); background: var(--color-surface-2); text-align: left; }
  .agent { width: 100%; height: auto; min-height: 52px; justify-content: flex-start; gap: var(--space-3); padding: 8px 10px; border-radius: var(--radius-md); text-align: left; }
  .agent[aria-checked='true'] { background: var(--color-active); }
  .logo { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--color-surface-3); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; line-height: 1.3; }
  .name { font-weight: 600; color: var(--color-foreground); }
  .plan { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .found { flex: none; font-size: var(--text-xs); color: var(--color-subtle); }
  .mark { flex: none; display: grid; place-items: center; width: 16px; color: var(--color-foreground); }
  .start { height: var(--control-lg); padding: 0 22px; border-radius: var(--radius-full); }
  @media (hover: hover) { .start:hover:not(:disabled) { background: color-mix(in srgb, var(--color-foreground) 86%, var(--color-background)); } }
  .other { margin-top: var(--space-1); }
  @media (max-width: 720px) {
    .start { min-width: 200px; }
    .agent { min-height: var(--touch-target); }
  }
</style>
