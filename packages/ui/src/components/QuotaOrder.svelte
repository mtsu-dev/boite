<script lang="ts">
  import { ArrowDown, ArrowUp } from '@lucide/svelte';
  import type { AccountQuota, GatewayOrder, GatewayOrderAccount, GatewayOrderChange, GatewayOrderProvider } from '@boite/contracts';
  import { errorText } from '../lib/errors';
  import { weekReset } from '../lib/quota-display';
  import { fill, strings } from '../lib/strings';
  import ProviderLogo from './ProviderLogo.svelte';
  import QuotaOverview from './QuotaOverview.svelte';

  /**
   * The limits panel's order mode: for each provider of the machine's Douane,
   * how its accounts are picked (the owner's order, or the soonest reset) and,
   * under the owner's order, the place of each account. Every press is written
   * at once and shown before Douane answers; a refusal puts the last answer
   * back and says why. The rows are the panel's own, with a place before and
   * two arrows after.
   */
  let { usage = $bindable(), rows, loading = false, completed = [], owner, failure = '', write, settings, testPrefix = 'quota' }: {
    /** What Douane holds; null until the first read lands. */
    usage: GatewayOrder | null;
    rows: AccountQuota[];
    loading?: boolean;
    completed?: string[];
    /** A paired device reads the limits and never changes the order. */
    owner: boolean;
    /** Why the read failed, when it did. */
    failure?: string;
    write: (change: GatewayOrderChange) => Promise<GatewayOrder>;
    settings: () => void;
    testPrefix?: string;
  } = $props();

  const FABLE = 'fable';
  /** The last answer of Douane, which a refused write goes back to. */
  let confirmed: GatewayOrder | null = null;
  let pending = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let refused = $state('');

  /** Claude first, then the providers with accounts to put in an order. */
  let providers = $derived((usage?.providers ?? [])
    .filter((provider) => provider.accounts.length > (provider.providerId === 'claude' ? 0 : 1))
    .sort((a, b) => Number(b.providerId === 'claude') - Number(a.providerId === 'claude')));

  const rowOf = (provider: GatewayOrderProvider, account: GatewayOrderAccount) =>
    rows.find((row) => row.providerId === provider.providerId && row.gateway?.entryId === account.id && row.gateway.display === 'accounts');

  /** The accounts as Douane takes them: the owner's order, or the week that ends soonest first. */
  function ordered(provider: GatewayOrderProvider): GatewayOrderAccount[] {
    if (provider.strategy !== 'reset-first') return provider.accounts;
    const reset = (account: GatewayOrderAccount) => { const row = rowOf(provider, account); return (row ? weekReset(row) : null) ?? Infinity; };
    return [...provider.accounts].sort((a, b) => reset(a) - reset(b));
  }

  /** Shows `change` at once, writes it, and goes back to Douane's last answer if it is refused. */
  function apply(provider: GatewayOrderProvider, change: Omit<GatewayOrderChange, 'providerId'>) {
    if (!usage) return;
    if (pending === 0) confirmed = usage;
    refused = '';
    usage = { ...usage, providers: usage.providers.map((entry) => entry.providerId !== provider.providerId ? entry : {
      ...entry,
      strategy: change.strategy ?? entry.strategy,
      spareFamilies: change.spareFamilies ?? entry.spareFamilies,
      accounts: change.ids ? change.ids.map((id, position) => ({ ...entry.accounts.find((account) => account.id === id)!, position })) : entry.accounts,
    }) };
    pending++;
    const sent = { providerId: provider.providerId, ...change };
    queue = queue.then(() => write(sent)).then((answer) => {
      confirmed = answer;
      if (--pending === 0) usage = answer;
    }, (error) => {
      pending--;
      usage = confirmed;
      refused = errorText(error);
    });
  }

  function move(provider: GatewayOrderProvider, index: number, by: -1 | 1) {
    const ids = provider.accounts.map((account) => account.id);
    const to = index + by;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
    apply(provider, { ids });
  }

  function spare(provider: GatewayOrderProvider, on: boolean) {
    const others = provider.spareFamilies.filter((family) => family !== FABLE);
    apply(provider, { spareFamilies: on ? [...others, FABLE] : others });
  }
</script>

<div class="order" data-testid={`${testPrefix}-order-mode`}>
  {#if !owner}
    <p class="note" data-testid={`${testPrefix}-order-remote`}>{strings.quotas.orderRemote}</p>
  {:else if failure}
    <p class="failed" role="alert" data-testid={`${testPrefix}-order-error`}>{fill(strings.quotas.orderReadFailed, { error: failure })}</p>
  {:else if usage === null}
    <p class="note" role="status">{strings.quotas.orderLoading}</p>
  {:else if usage.status === 'needsToken'}
    <div class="note" data-testid={`${testPrefix}-order-token`}>
      <p>{strings.quotas.orderNeedsToken}</p>
      <button type="button" class="small" onclick={settings}><span class="ui-label">{strings.quotas.allLimits}</span></button>
    </div>
  {:else if providers.length === 0}
    <p class="note">{strings.quotas.orderNone}</p>
  {:else}
    {#if refused}<p class="failed" role="alert" data-testid={`${testPrefix}-order-error`}>{fill(strings.quotas.orderFailed, { error: refused })}</p>{/if}
    {#each providers as provider (provider.providerId)}
      {@const mine = provider.strategy === 'fill-first'}
      {@const known = mine || provider.strategy === 'reset-first'}
      {@const accounts = ordered(provider)}
      <section data-testid="quota-order-provider" data-provider={provider.providerId}>
        {#if providers.length > 1}<h3><ProviderLogo providerId={provider.providerId} size={16} /><span class="ui-label">{provider.name}</span></h3>{/if}
        <div class="mode">
          <div class="segmented" role="group" aria-label={fill(strings.quotas.orderStrategy, { provider: provider.name })}>
            <button type="button" class:on={mine} aria-pressed={mine} data-testid="quota-order-mine" onclick={() => { if (!mine) apply(provider, { strategy: 'fill-first' }); }}><span class="ui-label">{strings.quotas.orderMine}</span></button>
            <button type="button" class:on={provider.strategy === 'reset-first'} aria-pressed={provider.strategy === 'reset-first'} data-testid="quota-order-reset" onclick={() => { if (provider.strategy !== 'reset-first') apply(provider, { strategy: 'reset-first' }); }}><span class="ui-label">{strings.quotas.orderReset}</span></button>
          </div>
          {#if !known}<p class="other" data-testid="quota-order-other">{fill(strings.quotas.orderOther, { strategy: provider.strategy, provider: provider.name })}</p>{/if}
          {#if provider.providerId === 'claude'}
            <label class="spare">
              <input type="checkbox" role="switch" checked={provider.spareFamilies.includes(FABLE)} data-testid="quota-order-spare" onchange={(event) => spare(provider, event.currentTarget.checked)} />
              <span class="text"><span class="ui-label">{strings.quotas.spareFable}</span><span class="hint">{strings.quotas.spareFableHint}</span></span>
            </label>
          {/if}
        </div>
        <ol>
          {#each accounts as account, index (account.id)}
            {@const row = rowOf(provider, account)}
            <li data-testid="quota-order-account" data-account={account.id} class:off={!account.enabled}>
              <span class="rank" aria-hidden="true">{known ? index + 1 : ''}</span>
              {#if row}
                <QuotaOverview rows={[row]} {loading} {completed} />
              {:else}
                <span class="plain"><ProviderLogo providerId={provider.providerId} size={20} /><span class="name ui-label" title={account.name}>{account.name}</span>{#if !account.enabled}<span class="hint">{strings.quotas.orderDisabled}</span>{/if}</span>
              {/if}
              {#if mine}
                <span class="moves">
                  <button type="button" class="ghost small icon" aria-label={fill(strings.quotas.orderUp, { name: account.name })} title={fill(strings.quotas.orderUp, { name: account.name })} disabled={index === 0} data-testid="quota-order-up" onclick={() => move(provider, index, -1)}><ArrowUp size={14} /></button>
                  <button type="button" class="ghost small icon" aria-label={fill(strings.quotas.orderDown, { name: account.name })} title={fill(strings.quotas.orderDown, { name: account.name })} disabled={index === accounts.length - 1} data-testid="quota-order-down" onclick={() => move(provider, index, 1)}><ArrowDown size={14} /></button>
                </span>
              {/if}
            </li>
          {/each}
        </ol>
      </section>
    {/each}
  {/if}
</div>

<style>
  .order { display: grid; grid-template-columns: minmax(0, 1fr); }
  section + section { margin-top: 6px; border-top: 1px solid var(--color-border); }
  h3 { display: flex; align-items: center; gap: 6px; margin: 0; padding: 10px 4px 0; font-size: var(--text-sm); font-weight: 600; }
  .mode { display: grid; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--color-border); }
  .segmented { display: flex; gap: 2px; padding: 3px; border-radius: var(--radius-md); background: var(--color-surface-3); }
  .segmented button { flex: 1; min-width: 0; height: var(--control-sm); padding: 0 8px; border: 0; background: none; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 500; }
  .segmented button:hover:not(.on) { color: var(--color-foreground); background: var(--color-hover); }
  .segmented button.on { background: var(--color-active); color: var(--color-foreground); box-shadow: var(--shadow-e1); }
  .segmented .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spare { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .spare .text { min-width: 0; display: grid; gap: 2px; color: var(--color-foreground); font-size: var(--text-sm); font-weight: 600; }
  .hint { color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 400; }
  .other, .note, .failed { margin: 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
  .other { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .note { padding: 14px 4px; color: var(--color-muted-foreground); }
  div.note { display: grid; justify-items: start; gap: 8px; }
  div.note p { margin: 0; }
  .failed { padding: 10px 4px 0; color: var(--color-danger); }
  ol { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 2px; }
  li + li { border-top: 1px solid var(--color-border); }
  li.off .plain { opacity: 0.6; }
  .rank { color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: var(--text-sm); font-variant-numeric: tabular-nums; text-align: center; }
  .plain { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 44px; padding: 6px 4px; }
  .plain .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-base); font-weight: 600; }
  .plain .hint { flex: none; }
  .moves { display: grid; gap: 2px; }
  @media (pointer: coarse) {
    .segmented button { min-height: var(--touch-target); }
    .moves { grid-auto-flow: column; }
  }
</style>
