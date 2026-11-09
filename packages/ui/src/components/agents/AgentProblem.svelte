<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte';
  import type { AgentProfile } from '@boite/contracts';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { routeCatalog, routeGone, withDefaultRoute } from '../../lib/agent-route';
  import { errorText } from '../../lib/errors';
  import { strings } from '../../lib/strings';
  import Menu from '../Menu.svelte';

  /**
   * What stops a bot, said over its conversation, with the remedy beside it.
   * A bot whose account is gone gets its other accounts in place (round 18):
   * one pick moves its default route there and repairs its allowed routes, as
   * its settings would. Any other problem opens its settings.
   */
  let { view, agent, problem, onfix }: { view: AgentsView; agent: AgentProfile; problem: string; onfix: () => void } = $props();
  const labels = $derived(strings.agents);
  const store = $derived(view.store);
  const gone = $derived(routeGone(store, agent.selection));
  /** Accounts that can sign in, the bot's own provider first: its model carries over there. Each row leads with its provider, the account under it. */
  const others = $derived(store.accounts
    .filter(account => account.id !== agent.selection.accountId && account.status !== 'unauthenticated' && store.providerOf(account.providerId))
    .sort((a, b) => Number(b.providerId === agent.selection.providerId) - Number(a.providerId === agent.selection.providerId)));
  let busy = $state(false);

  async function pick(accountId: string) {
    const account = others.find(entry => entry.id === accountId);
    const provider = account ? store.providerOf(account.providerId) : null;
    if (!account || !provider) return;
    const same = provider.id === agent.selection.providerId && agent.selection.model !== null;
    const model = same ? agent.selection.model : store.defaultModelOf(provider, account.id);
    const patch = { providerId: provider.id, accountId: account.id, model, effort: same ? agent.selection.effort : store.defaultEffortOf(provider.id, account.id, model) };
    busy = true;
    try {
      await view.save('agents.runtime.configure', async () => {
        const stored = await store.client!.call('agents.runtime.get', { agentId: agent.id });
        const latest = view.snapshot?.profiles.find(profile => profile.id === agent.id) ?? agent;
        return { agentId: agent.id, expectedRevision: latest.revision, config: withDefaultRoute(stored, patch, routeCatalog(store)) };
      });
    } catch (error) { view.error = errorText(error); }
    finally { busy = false; }
  }
</script>

<div class="agent-problem" role="alert" data-testid="agent-problem">
  <TriangleAlert size={15} strokeWidth={1.75} />
  <span>{problem}</span>
  {#if store.owner}
    {#if gone && others.length > 0}
      <Menu items={others.map(account => ({ id: account.id, label: store.providerOf(account.providerId)?.name ?? account.label, hint: account.label }))} onpick={id => void pick(id)} label={labels.pickAccount} placement="bottom" align="end" disabled={busy} testid="agent-problem-account">
        <span class="ui-label">{labels.pickAccount}</span>
      </Menu>
    {:else if gone}
      <button type="button" class="small" data-testid="agent-problem-add-account" onclick={() => store.showSettings('accounts')}>{labels.addAccount}</button>
    {:else}
      <button type="button" class="small" onclick={onfix}>{labels.fix}</button>
    {/if}
  {/if}
</div>
