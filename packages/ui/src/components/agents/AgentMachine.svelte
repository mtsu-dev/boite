<script lang="ts">
  import { ArrowRightLeft, ChevronDown } from '@lucide/svelte';
  import type { AgentProfile } from '@boite/contracts';
  import { botMoving, cancelMove, leavingLine, moveBot, moveItems, moveMachines, moveName } from '../../lib/agent-move-flow';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { strings } from '../../lib/strings';
  import Menu from '../Menu.svelte';

  /**
   * Where a bot lives, and the way to move it: the menu lists the other
   * members of its group, shut with why while one cannot take it (offline,
   * not this window's, an older Boite). A pick moves it as its row's menu
   * does (`agent-move-flow`). A move waiting for the bot's turn to end says
   * where it goes, with the button that cancels it.
   */
  let { view, agent }: { view: AgentsView; agent: AgentProfile } = $props();
  const labels = $derived(strings.agents.move);
  const store = $derived(view.store);
  const machines = $derived(moveMachines(store));
  const moving = $derived(botMoving(store, agent.id));
  const items = $derived(moveItems(store, agent.id));
  const leaving = $derived(leavingLine(view, agent.id));
  let cancelling = $state(false);
  async function cancel() {
    cancelling = true;
    try { await cancelMove(view, agent); } finally { cancelling = false; }
  }
</script>

<div class="agent-field agent-machine-row" data-testid="agent-move">
  <span>{labels.label}<small class="hint">{labels.hint}</small></span>
  {#if machines.others.length && store.owner}
    <Menu placement="bottom" label={labels.label} {items} onpick={id => void moveBot(view, agent, id)} testid="agent-move-pick" disabled={moving || !!leaving}>
      <span class="ui-label">{moving ? labels.moving : moveName(machines.here)}</span><ChevronDown size={13} />
    </Menu>
  {:else}
    <span class="agent-machine" data-testid="agent-move-here">{moveName(machines.here)}</span>
  {/if}
  {#if leaving}
    <div class="agent-leaving">
      <span class="pending" data-testid="agent-move-leaving"><ArrowRightLeft size={13} /><span class="ui-label">{leaving}</span></span>
      {#if store.owner}<button type="button" class="ghost small" onclick={cancel} disabled={cancelling} data-testid="agent-move-cancel">{strings.threadMove.cancelMove}</button>{/if}
    </div>
  {/if}
</div>

<style>
  .agent-leaving { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  /* The accent, as on its row and on a thread waiting to move. */
  .pending { display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .pending :global(svg) { flex: none; }
</style>
