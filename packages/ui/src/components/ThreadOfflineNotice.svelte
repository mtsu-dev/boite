<script lang="ts">
  import { CloudOff } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import MachineReconnect from './MachineReconnect.svelte';
  import Notice from './Notice.svelte';

  /*
   * Over the composer of a thread whose machine is out of reach, said once:
   * the machine's name, what becomes of a message sent now behind the "i",
   * and Reconnect, as the project card's and Machines' do. It leaves by
   * itself once the machine answers.
   */
  let { store, machine }: { store: Store; machine: string } = $props();
</script>

<Notice icon={CloudOff} testid="composer-offline" title={fill(strings.composer.machineOffline, { machine })}
  info={fill(strings.composer.machineOfflineHint, { machine })} docked replaces>
  {#snippet actions()}<MachineReconnect {store} testid="thread-reconnect" inline />{/snippet}
</Notice>
