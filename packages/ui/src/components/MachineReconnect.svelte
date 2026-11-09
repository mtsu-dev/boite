<script lang="ts">
  import { RefreshCw } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';
  import { WsClient } from '../lib/ws-client';
  import Spinner from './Spinner.svelte';

  /**
   * The next step at the foot of a project card whose machine is out of reach (Sidebar.svelte, the phone list), so
   * the Offline mark never ends the card on a label: a closed client opens again, one waiting out its
   * backoff tries now, as Machines' Reconnect does. The card comes back by itself once the machine answers.
   */
  let { store, testid = 'project-reconnect', inline = false }: {
    store: Store;
    testid?: string;
    /** Drawn among other actions (a Machines row): the button alone, no foot of its own. */
    inline?: boolean;
  } = $props();
  let busy = $state(false);

  async function reconnect(): Promise<void> {
    busy = true;
    try {
      const client = store.client;
      if (store.connection === 'closed' || !(client instanceof WsClient)) await store.connect();
      else await client.wake();
    } catch { /* The card keeps its state; the client retries on its own. */ }
    finally { busy = false; }
  }
</script>

<div class="reconnect" class:inline>
  <button type="button" class="small" data-testid={testid} disabled={busy} onclick={() => void reconnect()}>{#if busy}<Spinner size={13} />{:else}<RefreshCw size={13} aria-hidden="true" />{/if}<span class="ui-label">{strings.connection.reconnect}</span></button>
</div>

<style>
  /* On the rows' text edge, under the last row it leaves as last seen. */
  .reconnect { display: flex; padding: 4px 8px 6px; }
  .reconnect button { gap: 6px; }
  .reconnect.inline { display: contents; }
  @media (max-width: 720px) {
    .reconnect:not(.inline) { padding: 4px 12px 12px; }
    .reconnect button { min-height: var(--touch-target); height: auto; padding: 0 14px; }
  }
</style>
