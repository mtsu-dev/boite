<script lang="ts">
  import { Monitor } from '@lucide/svelte';
  import { appMark } from '../lib/app-update.svelte';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';
  import MobileConnect from './MobileConnect.svelte';
  import MobileTabs from './MobileTabs.svelte';

  let { store, screen, navigate, onpaired }: {
    store: Store;
    screen: 'chat' | 'threads' | 'activity';
    navigate: (screen: 'threads' | 'activity') => void;
    onpaired: () => void;
  } = $props();
</script>

<header class="mobile-header" data-testid="mobile-header">
  <img src={appMark()} alt="" width="30" height="30" />
  <strong data-testid="mobile-title">Boite</strong>
  <button type="button" class="ghost icon" data-testid="mobile-connection" aria-label={strings.mobile.pairingRequired} title={strings.mobile.pairingRequired} onclick={() => store.showSettings('machines')}>
    <Monitor size={20} /><span class="dot"></span>
  </button>
</header>

<section class="pairing-page" data-testid="mobile-list" aria-label={strings.mobile.pairingRequired}>
  <MobileConnect {store} {onpaired} />
</section>

<MobileTabs {store} {screen} waiting={0} {navigate} />

<style>
  header { grid-row: 1; grid-column: 1; display: flex; align-items: center; gap: 10px; min-height: 60px; padding: max(8px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left)); border-bottom: 1px solid var(--color-border); }
  img { flex: none; border-radius: var(--radius-md); }
  strong { flex: 1; font-size: var(--text-lg); font-weight: 600; letter-spacing: -0.4px; }
  button { position: relative; flex: none; width: var(--touch-target); height: var(--touch-target); color: var(--color-muted-foreground); }
  .dot { position: absolute; top: 9px; right: 8px; width: 7px; height: 7px; border-radius: 50%; background: var(--color-muted-foreground); box-shadow: 0 0 0 2px var(--color-background); }
  .pairing-page { grid-row: 2; grid-column: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px max(16px, env(safe-area-inset-right)) 24px max(16px, env(safe-area-inset-left)); }
</style>
