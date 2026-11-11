<script lang="ts">
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import MachineReconnect from './MachineReconnect.svelte';

  /**
   * A machine out of reach, said once in a full line where its work is listed (a project card's head on the desktop
   * and the phone, its Machines row): the status grammar's grey dot, "Builder is offline", and Reconnect on that
   * same line, so the next step stands beside the state instead of at a card's foot. Connecting, it is already
   * trying: the words change and the button goes.
   */
  let { store, label, testid = 'project-offline', reconnectTestid = 'project-reconnect' }: {
    store: Store;
    label: string;
    testid?: string;
    reconnectTestid?: string;
  } = $props();
  const connecting = $derived(store.connection === 'connecting');
</script>

<p class="machine-offline" data-testid={testid} data-state={connecting ? 'connecting' : 'offline'}>
  <span class="dot" class:connecting aria-hidden="true"></span>
  <span class="words ui-label">{fill(connecting ? strings.machines.connectingLine : strings.machines.offlineLine, { machine: label })}</span>
  {#if !connecting}<MachineReconnect {store} testid={reconnectTestid} inline />{/if}
</p>

<style>
  .machine-offline { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; margin: 0; font-size: var(--text-xs); line-height: 18px; color: var(--color-muted-foreground); }
  /* The status grammar's dots (Menu.svelte's `.status-dot`): grey away, amber while it tries. */
  .dot { flex: none; width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--color-muted-foreground); }
  .dot.connecting { background: var(--color-live); }
  .words { min-width: 0; overflow-wrap: anywhere; }
  .machine-offline :global(button) { margin-left: auto; }
</style>
