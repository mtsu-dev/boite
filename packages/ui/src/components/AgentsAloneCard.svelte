<script lang="ts">
  import { agentBotCreation, coordinationReach, COORDINATION_REACH, type CoordinationReach } from '@boite/contracts';
  import CardScope from './CardScope.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { toggled } from '../lib/autosave.svelte';

  /**
   * The two things an agent may do without a card, one machine's settings:
   * how far a conversation's agent reaches other conversations
   * (`coordinationReach`) and whether it creates a bot without asking
   * (`agentBotCreation`). General on a desktop, Conversations on a phone.
   */
  let { store }: { store: Store } = $props();
  const uid = $props.id();
  const words = $derived(strings.agentsAlone);
  const reach = $derived(coordinationReach(store.settings ?? {}));
  const free = $derived(agentBotCreation(store.settings ?? {}) === 'free');

  function pick(next: CoordinationReach): void {
    if (next !== reach) void store.saveSettings({ coordinationReach: next });
  }
</script>

<section class="card" id="settings-agents-alone" data-testid="settings-agents-alone">
  <h2 class="ui-label-box"><span class="ui-label">{words.heading}</span><CardScope {store} /></h2>
  <div class="reach">
    <div class="switch-row">
      <span class="text"><span class="ui-label-box"><span id="{uid}-reach-name">{words.reach}</span></span></span>
      <div class="segmented" role="group" aria-labelledby="{uid}-reach-name" aria-describedby="{uid}-reach-effect" data-testid="setting-coordination-reach">
        {#each COORDINATION_REACH as step (step)}
          <button type="button" class:on={reach === step} aria-pressed={reach === step} data-testid="coordination-reach-{step}" onclick={() => pick(step)}><span class="ui-label">{words.steps[step]}</span></button>
        {/each}
      </div>
    </div>
    <p class="hint effect" id="{uid}-reach-effect" data-testid="coordination-reach-effect">{words.effects[reach]}</p>
  </div>
  <label for="{uid}-bot-creation" class="switch-row">
    <span class="text"><span class="ui-label-box"><span id="{uid}-bot-creation-name">{words.bots}</span></span><span class="hint" id="{uid}-bot-creation-effect">{words.botsEffect}</span></span>
    <input id="{uid}-bot-creation" aria-labelledby="{uid}-bot-creation-name" aria-describedby="{uid}-bot-creation-effect" type="checkbox" role="switch" data-testid="setting-agent-bot-creation" checked={free} onchange={(event) => void toggled(event.currentTarget, on => store.saveSettings({ agentBotCreation: on ? 'free' : 'ask' }))} />
  </label>
</section>

<style>
  .reach { display: flex; flex-direction: column; min-width: 0; }
  .reach .switch-row { flex-wrap: wrap; }
  /* Three steps never run past the card: on a narrow screen they share its width. */
  .segmented { max-width: 100%; min-width: 0; }
  .segmented button { flex: 1 1 auto; min-width: 0; white-space: nowrap; }
  @media (max-width: 720px) {
    .segmented { display: flex; flex: 1 1 100%; }
    .segmented button { padding: 0 4px; }
  }
  .effect { margin: 0 0 8px; }
</style>
