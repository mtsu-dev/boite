<script lang="ts">
  import { untrack } from 'svelte';
  import type { FirewallStatus, NetworkCategory } from '@boite/contracts';
  import { TriangleAlert } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';

  /**
   * Windows Defender Firewall between a phone and this core. Shown while the
   * core listens on the local network and Windows does not let it through:
   * the prompt Windows raises names the core's runtime, "Bun" by "Oven", and
   * dismissing it, or a network changing from public to private, leaves a
   * phone at a page that never loads. The button asks Windows once, as an
   * administrator, for a rule that covers private networks. A public or work
   * network stays closed: the notice says how to mark it private, and offers
   * no button.
   */
  let { store }: { store: Store } = $props();
  const text = strings.group.firewall;

  let status = $state<FirewallStatus | null>(null);
  let busy = $state(false);
  let done = $state(false);

  const listening = $derived(store.settings?.listenOnLan === true);

  async function read(): Promise<void> {
    const client = store.client;
    if (!client) return;
    try {
      status = await client.call('firewall.status', {});
    } catch {
      status = null;
    }
  }

  /** Asks Windows for the rule unless it is already there; the switch calls it the moment it turns the network on. */
  export async function allow(): Promise<void> {
    const client = store.client;
    if (!client || busy) return;
    busy = true;
    done = false;
    try {
      const before = status ?? (await client.call('firewall.status', {}));
      if (before.state === 'unsupported' || before.state === 'ready') {
        status = before;
        return;
      }
      status = await client.call('firewall.allow', {});
      done = status.state === 'ready';
    } catch {
      status = null;
    } finally {
      busy = false;
    }
  }

  // Read on arrival, on reconnection and when the switch turns on; the call's own state is not a reason to read again.
  $effect(() => {
    if (store.connection === 'ready' && store.owner && listening) untrack(() => void read());
  });

  function names(list: NetworkCategory[]): string {
    return list.map((name) => text.networks[name]).join(text.and);
  }

  const problem = $derived(
    !status ? '' :
    status.state === 'blocked' ? fill(text.blocked, { networks: names(status.blocked) }) :
    status.state === 'unset' ? fill(text.unset, { networks: names(status.networks.filter((name) => !status!.allowed.includes(name))) }) :
    status.state === 'public' ? (status.networks.includes('public') ? strings.group.lan.public : strings.group.lan.domain) :
    status.state === 'error' ? text.unreadable : ''
  );
  // An unreadable firewall is said by `unreadable`; no change was tried, so none was refused.
  const outcome = $derived(!status?.detail || status.state === 'error' ? '' : status.detail === 'cancelled' ? text.cancelled : text.failed);
</script>

{#if listening && store.owner}
  {#if problem}
    <!-- One row: what blocks the phone, and the one button that fixes it. The outcome of a refused try is the only second line. -->
    <div class="firewall" data-testid="firewall-notice" data-state={status?.state}>
      <TriangleAlert class="mark" size={15} strokeWidth={1.75} aria-hidden="true" />
      <p class="problem">{problem}</p>
      {#if status?.state !== 'error' && status?.state !== 'public'}
        <button type="button" class="small" data-testid="firewall-allow" disabled={busy || store.connection !== 'ready'} onclick={() => void allow()}>
          <span class="ui-label">{busy ? text.allowing : text.allow}</span>
        </button>
      {/if}
      {#if outcome}<p class="hint outcome" data-testid="firewall-outcome">{outcome}</p>{/if}
    </div>
  {:else if done}
    <p class="hint allowed" data-testid="firewall-allowed">{text.allowed}</p>
  {/if}
{/if}

<style>
  .firewall {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin-top: 14px;
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }
  .firewall :global(.mark) { flex: none; align-self: flex-start; margin-top: 2px; color: var(--color-live); }
  /* The mark stays on the first line's height however the sentence wraps. */
  .firewall p { margin: 0; }
  .problem { flex: 1 1 16em; min-width: 0; line-height: 1.4; }
  .firewall button { flex: none; margin-left: auto; }
  .outcome { flex-basis: 100%; padding-left: 25px; }
  .allowed { margin: 14px 0 0; }
  @media (max-width: 720px) { .firewall button { min-height: var(--touch-target); } }
</style>
