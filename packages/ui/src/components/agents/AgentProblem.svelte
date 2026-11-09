<script lang="ts">
  import { TriangleAlert, UserX } from '@lucide/svelte';
  import type { AgentProfile } from '@boite/contracts';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { routeCatalog, routeGone, withDefaultRoute } from '../../lib/agent-route';
  import { errorText } from '../../lib/errors';
  import { accountName } from '../../lib/account-name';
  import { fill, strings } from '../../lib/strings';
  import Menu from '../Menu.svelte';
  import Notice from '../Notice.svelte';

  /**
   * What stops a bot, said over its conversation, with the remedy beside it.
   * A bot whose account is gone gets its other accounts in place:
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

{#snippet remedy()}
  {#if gone && others.length > 0}
    <Menu items={others.map(account => ({ id: account.id, label: store.providerOf(account.providerId)?.name ?? accountName(account), hint: accountName(account) }))} onpick={id => void pick(id)} label={labels.pickAccount} variant="button" placement="bottom" align="end" disabled={busy} testid="agent-problem-account">
      <span class="ui-label">{labels.pickAccount}</span>
    </Menu>
  {:else if gone}
    <button type="button" class="small" data-testid="agent-problem-add-account" onclick={() => store.showSettings('accounts')}>{labels.addAccount}</button>
  {:else}
    <button type="button" class="small" onclick={onfix}>{labels.fix}</button>
  {/if}
{/snippet}

<!-- A removed account reads as the composer's chip says it: the same glyph, the same cause, the same one remedy;
     the sentence that names the bot and the core's own words stay in its tooltip. -->
<div class="agent-problem">
  <Notice icon={gone ? UserX : TriangleAlert} tone="caution" role="alert" testid="agent-problem" docked
    detail={gone ? strings.accounts.removed : problem} tip={gone ? `${fill(strings.composer.botAccountGone, { name: agent.name })}\n${problem}` : undefined}
    ids={{ detail: gone ? 'agent-problem-cause' : undefined }} actions={store.owner ? remedy : undefined} />
</div>
