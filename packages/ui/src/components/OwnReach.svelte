<script lang="ts">
  import { untrack } from 'svelte';
  import type { FirewallStatus, GroupCore } from '@boite/contracts';
  import { lockedBy } from '../lib/policy';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';
  import PolicyLock from './PolicyLock.svelte';

  /**
   * How a phone or a computer on the same Wi-Fi reaches this machine of the
   * group, under its row. A grouped core listens on its private LAN addresses
   * by itself and publishes them: the line names the first, else says what
   * keeps it closed. The admin policy; Windows Firewall, which lets the core
   * through on private networks once the owner allowed it and keeps it closed
   * on a public or work one; or nothing at all, a machine that listens only on
   * itself.
   */
  let { store, self, row = false, mobile = false }: {
    store: Store;
    self: GroupCore | undefined;
    /** Under the machine's row, aligned with its name; else a line of its own under the card's heading. */
    row?: boolean;
    mobile?: boolean;
  } = $props();
  const text = strings.group.lan;
  /** An address only the machine itself can dial. */
  const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/;

  let status = $state<FirewallStatus | null>(null);
  let busy = $state(false);

  /** RFC 1918, as the core picks the addresses it listens on. */
  function privateHost(address: string): string | null {
    let url: URL;
    try { url = new URL(address); } catch { return null; }
    const parts = url.hostname.split('.').map(Number);
    if (url.protocol !== 'http:' || parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const [a, b] = parts as [number, number];
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ? url.host : null;
  }

  const owner = $derived(store.owner && store.principal !== null);
  const lan = $derived(self?.addresses.map(privateHost).find((host) => host !== null) ?? null);
  const network = $derived(store.policy?.present ? store.policy.values.network : undefined);
  const forbidden = $derived(network?.lan === false || network?.groups === false);
  const locked = $derived(lockedBy(store.policy, 'network.lan', 'network.groups') !== null);
  const loopback = $derived(self !== undefined && self.addresses.length > 0 && self.addresses.every((address) => LOOPBACK.test(address)));

  /** One reading at a time: each runs PowerShell on the machine. */
  let reading = false;
  async function read(): Promise<void> {
    const client = store.client;
    if (!client || reading) return;
    reading = true;
    try { status = await client.call('firewall.status', {}); } catch { status = null; } finally { reading = false; }
  }

  /** The existing `firewall.allow`: one administrator prompt for the private rule, then the core opens its listener. */
  async function allow(): Promise<void> {
    const client = store.client;
    if (!client || busy || locked) return;
    busy = true;
    try { status = await client.call('firewall.allow', {}); } catch { status = null; } finally { busy = false; }
  }

  // Windows is asked only while nothing else explains a closed LAN; the owner alone may read the firewall.
  $effect(() => {
    if (store.connection === 'ready' && owner && lan === null && !forbidden) untrack(() => void read());
  });

  const reach = $derived(
    lan !== null ? 'ready' :
    forbidden ? 'policy' :
    status?.state === 'public' ? (status.networks.includes('public') ? 'public' : 'domain') :
    status?.state === 'unset' || status?.state === 'blocked' ? 'closed' :
    loopback ? 'loopback' : null
  );
  // Back from Windows settings, where the owner marked the network private or allowed Boite: Windows is read again,
  // and the core, which hears that reading, opens its listener.
  $effect(() => {
    if (reach !== 'closed' && reach !== 'public' && reach !== 'domain') return;
    const again = () => { if (document.visibilityState === 'visible' && !busy) void read(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  });
  const outcome = $derived(!status?.detail ? '' : status.detail === 'cancelled' ? strings.group.firewall.cancelled : strings.group.firewall.failed);
</script>

{#if reach}
  <div class="reach" class:row class:mobile data-testid="own-reach" data-state={reach}>
    <!-- A machine that only listens on itself has nothing to act on here: a short line, the why behind its "i". -->
    <p class="hint" class:warn={reach === 'closed' || reach === 'public' || reach === 'domain'}>
      {#if reach === 'loopback'}<span class="ui-label-box"><span class="ui-label">{strings.group.loopbackShort}</span><InfoTip topic={strings.group.loopbackShort} text={strings.group.loopback} /></span>
      {:else}{reach === 'ready' ? fill(text.ready, { address: lan ?? '' }) : reach === 'policy' ? text.policy
        : reach === 'public' ? text.public : reach === 'domain' ? text.domain : text.closed}{/if}
      {#if reach === 'policy'}<PolicyLock {store} keys={['network.lan', 'network.groups']} />{/if}
    </p>
    {#if reach === 'closed' && outcome}<p class="hint" data-testid="own-reach-outcome">{outcome}</p>{/if}
    {#if reach === 'closed' && owner}
      <div class="actions">
        <button type="button" class="primary small" data-testid="own-reach-allow" disabled={busy || locked || store.connection !== 'ready'} onclick={() => void allow()}>
          <span class="ui-label">{busy ? strings.group.firewall.allowing : text.allow}</span>
        </button>
        <PolicyLock {store} keys={['network.lan', 'network.groups']} />
      </div>
    {/if}
  </div>
{/if}

<style>
  .reach { display: grid; justify-items: start; gap: 8px; margin-top: 10px; }
  .reach.row { margin: 2px 0 0 48px; }
  .reach.row.mobile { margin-left: 0; }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--color-muted-foreground);
  }
  .warn { color: var(--color-live); }
  .actions { display: flex; align-items: center; }
  .mobile button { min-height: var(--touch-target); }
  @media (max-width: 720px) {
    .reach.row { margin-left: 0; }
    button { min-height: var(--touch-target); }
  }
</style>
