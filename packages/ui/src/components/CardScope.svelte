<script lang="ts">
  import { Monitor, MonitorSmartphone, UserRound } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { machineName, workspace } from '../lib/workspace.svelte';

  /**
   * Where a settings card's rows apply, at the right of its head, in one short
   * phrase the cards of a page pair up on: "For this device only" beside "For
   * agents on studio", so a device card under a machine's line never reads as
   * the machine's. No `store` and no `account`: this device. A `store`: that
   * machine, by name. An `account`: that account.
   */
  let { store, account }: { store?: Store; account?: string } = $props();
  let machine = $derived(store ? workspace.machines.find((entry) => entry.store === store) : undefined);
  let kind = $derived(account !== undefined ? 'account' : store ? 'machine' : 'device');
  let text = $derived(account !== undefined ? fill(strings.settings.scopeAccount, { account })
    : store ? fill(strings.settings.cardMachine, { machine: machine ? machineName(machine) : strings.machines.local })
    : strings.settings.cardDevice);
</script>

<span class="card-scope" data-testid="card-scope" data-kind={kind}>
  {#if kind === 'account'}<UserRound size={13} strokeWidth={1.75} aria-hidden="true" />{:else if kind === 'machine'}<Monitor size={13} strokeWidth={1.75} aria-hidden="true" />{:else}<MonitorSmartphone size={13} strokeWidth={1.75} aria-hidden="true" />{/if}<span class="ui-label">{text}</span>
</span>
