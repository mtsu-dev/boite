<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import type { AgentProfile } from '@boite/contracts';
  import { moveEnded, moveRefusedForGood, moveRequestId } from '../../lib/agent-move';
  import { openAgent, type AgentsView } from '../../lib/agents.svelte';
  import { confirm } from '../../lib/confirm.svelte';
  import { errorText } from '../../lib/errors';
  import { GroupLinks } from '../../lib/group-links.svelte';
  import type { MenuItem } from '../../lib/menu';
  import { RpcFailure } from '../../lib/rpc-error';
  import { fill, strings } from '../../lib/strings';
  import { listedName, workspace, type Machine } from '../../lib/workspace.svelte';
  import Menu from '../Menu.svelte';

  /**
   * Where a bot lives, and the way to move it: the menu lists the other
   * connected machines of its group. A pick asks in the app's dialog, then
   * `agents.move` runs on the machine that holds the bot, and the Bots page
   * opens it on its new machine. A refusal is told in the toast. A try that
   * did not finish keeps its `requestId` for the next one (`agent-move`).
   */
  let { view, agent }: { view: AgentsView; agent: AgentProfile } = $props();
  const labels = $derived(strings.agents.move);
  const store = $derived(view.store);
  let moving = $state(false);

  const here = $derived(workspace.machines.find(machine => machine.store === store));
  const name = (machine: Machine | undefined) => machine ? listedName(machine) : strings.machines.local;
  /** The other members of its group this window reaches as their owner. */
  const others = $derived(store.group ? workspace.machines.filter(machine => machine.store !== store && machine.store.connection === 'ready'
    && machine.store.owner && machine.store.group?.id === store.group!.id) : []);
  const ready = (machine: Machine) => machine.store.core?.features?.botMove === true;
  const items = $derived<MenuItem[]>([
    { id: here?.id ?? '', label: name(here), active: true, disabled: true },
    ...others.map(machine => ready(machine)
      ? { id: machine.id, label: name(machine), disabled: moving }
      : { id: machine.id, label: name(machine), disabled: true, hint: labels.olderShort, title: fill(labels.older, { machine: name(machine) }) })
  ]);

  async function pick(id: string) {
    const target = others.find(machine => machine.id === id);
    if (!target || moving || !ready(target)) return;
    const coreId = GroupLinks.coreOf(target);
    if (!coreId) return;
    const ok = await confirm.ask({
      title: fill(labels.title, { name: agent.name, machine: name(target) }),
      body: fill(labels.body, { name: agent.name, machine: name(target), source: name(here) }),
      confirmLabel: labels.confirm,
      cancelLabel: strings.common.cancel,
    });
    if (!ok) return;
    const client = store.client;
    if (!client) { store.error = strings.connection.unavailable; return; }
    moving = true;
    const source = here?.id ?? store.machineId;
    try {
      await client.call('agents.move', { agentId: agent.id, machine: coreId, requestId: moveRequestId(source, agent.id, coreId) });
    } catch (error) {
      if (moveRefusedForGood(error)) moveEnded(source, agent.id, coreId);
      const busy = error instanceof RpcFailure && (error.data as { reason?: unknown } | undefined)?.reason === 'turn-in-flight';
      store.error = busy ? fill(labels.turnInFlight, { name: agent.name }) : errorText(error);
      moving = false;
      return;
    }
    moveEnded(source, agent.id, coreId);
    // The bot now lives there: the Bots page follows it, and this sheet goes with the page it was on.
    await workspace.select(target.store);
    target.store.showAgents();
    await openAgent(target.store, agent.id);
  }
</script>

<div class="agent-field agent-machine-row" data-testid="agent-move">
  <span>{labels.label}<small class="hint">{labels.hint}</small></span>
  {#if others.length && store.owner}
    <Menu placement="bottom" label={labels.label} {items} onpick={id => void pick(id)} testid="agent-move-pick" disabled={moving}>
      <span class="ui-label">{moving ? labels.moving : name(here)}</span><ChevronDown size={13} />
    </Menu>
  {:else}
    <span class="agent-machine" data-testid="agent-move-here">{name(here)}</span>
  {/if}
</div>
