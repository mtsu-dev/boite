<script lang="ts">
  import { untrack } from 'svelte';
  import { gatewayReader, quotaReader, shownQuotas } from '../lib/quota-reader.svelte';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';
  import { MediaQuery } from 'svelte/reactivity';
  import { desktopSettings } from '../lib/settings-tabs';
  import QuotaPopup from './QuotaPopup.svelte';
  import QuotaMachineScope from './QuotaMachineScope.svelte';
  import QuotaPin from './QuotaPin.svelte';

  /**
   * The app rail's Limits: the tray's glance at every account's subscription
   * windows, without leaving the conversation. It reads the core it belongs
   * to while open, keeps the last reading on screen while the next loads, and
   * sends monitoring and accounts to the Limits page.
   */
  let { store, close, open }: { store: Store; close: (restoreFocus?: boolean) => void; open: boolean } = $props();
  /** Providers is a desktop settings page and the owner's: a phone is offered no way to it. */
  const phoneWidth = new MediaQuery('(max-width: 720px)');
  let providersReachable = $derived(store.owner && desktopSettings(phoneWidth.current));

  let reader = $derived(quotaReader(store.endpointUrl ?? 'here', store.core));
  let gateway = $derived(gatewayReader(store.endpointUrl ?? 'here'));
  let rows = $derived(reader.rows === null ? null : shownQuotas(reader.rows, store.accounts, store.providers));
  /**
   * The row the open thread spends: its account's own, or, when a gateway stands in for that provider with one
   * row, that one. Several gateway rows of the provider: Douane picks per call, so none is named.
   */
  let current = $derived.by(() => {
    const thread = store.openThread;
    if (!thread || !rows) return null;
    if (rows.some((row) => row.accountId === thread.accountId)) return thread.accountId;
    const same = rows.filter((row) => row.gateway && row.providerId === thread.providerId);
    return same.length === 1 ? same[0]!.accountId : null;
  });
  /** A paired device reads what the core holds: forcing the providers is the owner's. */
  function read(refresh = false) {
    if (store.client) void reader.read(store.client, refresh && store.owner).catch(() => {});
  }

  $effect(() => {
    const client = store.client;
    const current = reader;
    if (!client) return;
    const off = client.on('quotas.updated', (value) => current.accept(value));
    untrack(() => read());
    return off;
  });

  // A slow gateway can answer while the glance is open. If it only has a dashboard, show that page.
  $effect(() => {
    const proxy = store.settings?.subscriptionProxy;
    if (open && proxy?.enabled && proxy.kind === 'douane' && gateway.state?.status === 'unsupported') untrack(() => page('limits'));
  });

  const shownPage = untrack(() => store.page);
  $effect(() => { if (store.page !== shownPage) untrack(() => close(false)); });

  function page(tab: 'limits' | 'accounts') {
    close(false);
    store.showSettings(tab);
  }
</script>

<QuotaPopup {rows} {current} loading={reader.busy} completed={reader.landed} error={reader.error ?? ''} outdated={reader.outdated} owner={store.owner}
  order={store.settings?.quotaOrder ?? []} reorder={store.owner ? (quotaOrder) => store.saveSettings({ quotaOrder }) : undefined}
  refresh={() => read(true)} connect={providersReachable ? () => page('accounts') : undefined} settings={() => page('limits')} close={() => close()} testPrefix="limits-glance">
  {#snippet title()}<QuotaMachineScope {store} />{/snippet}
  {#snippet actions()}<QuotaPin />{/snippet}
</QuotaPopup>
