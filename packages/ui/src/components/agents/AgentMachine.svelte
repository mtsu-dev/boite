<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import type { AgentProfile } from '@boite/contracts';
  import { botMoving, moveBot, moveItems, moveMachines, moveName } from '../../lib/agent-move-flow';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { strings } from '../../lib/strings';
  import Menu from '../Menu.svelte';

  /**
   * Where a bot lives, and the way to move it: the menu lists the other
   * members of its group, shut with why while one cannot take it (offline,
   * not this window's, an older Boite). A pick moves it as its row's menu
   * does (`agent-move-flow`).
   */
  let { view, agent }: { view: AgentsView; agent: AgentProfile } = $props();
  const labels = $derived(strings.agents.move);
  const store = $derived(view.store);
  const machines = $derived(moveMachines(store));
  const moving = $derived(botMoving(store, agent.id));
  const items = $derived(moveItems(store, agent.id));
</script>

<div class="agent-field agent-machine-row" data-testid="agent-move">
  <span>{labels.label}<small class="hint">{labels.hint}</small></span>
  {#if machines.others.length && store.owner}
    <Menu placement="bottom" label={labels.label} {items} onpick={id => void moveBot(store, agent, id)} testid="agent-move-pick" disabled={moving}>
      <span class="ui-label">{moving ? labels.moving : moveName(machines.here)}</span><ChevronDown size={13} />
    </Menu>
  {:else}
    <span class="agent-machine" data-testid="agent-move-here">{moveName(machines.here)}</span>
  {/if}
</div>
