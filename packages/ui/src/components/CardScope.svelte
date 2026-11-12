<script lang="ts">
  import { Monitor, MonitorSmartphone, UserRound } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { pageScope, type ScopeKind } from '../lib/page-scope.svelte';
  import { fill, strings } from '../lib/strings';
  import { machineName, workspace } from '../lib/workspace.svelte';

  /**
   * Where a settings card's rows apply, at the right of its head, in one short
   * phrase the cards of a page pair up on: "For this device only" beside "For
   * agents on studio". No `store` and no `account`: this device. A `store`:
   * that machine, by name. An `account`: that account, always said, since it
   * names whose setting it is. A device or machine tag shows only on a card
   * that differs from the line under the page's title, which says the rest
   * once (`lib/page-scope.svelte.ts`).
   */
  let { store, account }: { store?: Store; account?: string } = $props();
  let machine = $derived(store ? workspace.machines.find((entry) => entry.store === store) : undefined);
  let kind = $derived<ScopeKind | 'account'>(account !== undefined ? 'account' : store ? 'machine' : 'device');
  let text = $derived(account !== undefined ? fill(strings.settings.scopeAccount, { account })
    : store ? fill(strings.settings.cardMachine, { machine: machine ? machineName(machine) : strings.machines.local })
    : strings.settings.cardDevice);

  const scope = pageScope();
  let id = $state<symbol | null>(null);
  $effect(() => {
    const card = kind;
    if (!scope || card === 'account') return;
    const entry = scope.add(card);
    id = entry.id;
    return entry.remove;
  });
  let shown = $derived(kind === 'account' || !scope || scope.tags(kind));
  let picker = $derived(kind === 'machine' && scope && id ? scope.pickerFor(id) : undefined);
</script>

{#if shown}
  <span class="card-scope" class:picks={picker !== undefined} data-testid="card-scope" data-kind={kind}>
    {#if picker}
      {@render picker(strings.settings.cardMachine)}
    {:else}
      {#if kind === 'account'}<UserRound size={13} strokeWidth={1.75} aria-hidden="true" />{:else if kind === 'machine'}<Monitor size={13} strokeWidth={1.75} aria-hidden="true" />{:else}<MonitorSmartphone size={13} strokeWidth={1.75} aria-hidden="true" />{/if}<span class="ui-label">{text}</span>
    {/if}
  </span>
{/if}
