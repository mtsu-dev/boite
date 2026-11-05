<script lang="ts">
  import { Check, Copy, ShieldCheck, X } from '@lucide/svelte';
  import type { TailscaleStatus } from '@boite/contracts';
  import { onDestroy, untrack } from 'svelte';
  import FirewallNotice from './FirewallNotice.svelte';
  import LanReach, { isLoopback } from './LanReach.svelte';
  import { errorText } from '../lib/errors';
  import { time } from '../lib/format';
  import { lockedBy } from '../lib/policy';
  import { qrSvg } from '../lib/qr';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * "Add a device": one QR code. A phone scans it with its Boite app; a
   * computer copies the link and pastes it under Join. A link that names
   * loopback reaches nothing but this computer, so it gets no QR code and
   * offers the local network instead.
   */
  let { store }: { store: Store } = $props();
  const uid = $props.id();
  const invite = $derived(store.deviceInvite);
  const loopback = $derived(!!invite && isLoopback(invite.url));

  let qr = $state('');
  $effect(() => {
    // The phone's part only: the invitation a computer joins with stays in the copied link, and out of a denser code.
    const url = invite?.url.split('#')[0];
    // A new link never shows the last one's code meanwhile.
    qr = '';
    if (!url) return;
    let live = true;
    void qrSvg(url).then((svg) => { if (live) qr = svg; }, () => undefined);
    return () => { live = false; };
  });

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(timer));
  let linkInput = $state<HTMLInputElement>();
  /**
   * A page served over plain HTTP has no clipboard API: the link is selected
   * in its field and copied the older way, and stays selected to copy by hand.
   */
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite?.url ?? '');
    } catch {
      linkInput?.focus();
      linkInput?.select();
      if (!document.execCommand?.('copy')) return;
    }
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => { copied = false; }, 1500);
  }
  let firewall: FirewallNotice | undefined = $state();

  /**
   * A link over plain HTTP opens nowhere from the phone app, an HTTPS page. A
   * machine whose Tailscale is ready to serve it (`off`: signed in, MagicDNS
   * and certificates on, 443 free) gets HTTPS in one click, as the Tailscale
   * switch of Settings does, and a new link through that address. Any other
   * state is that switch's to explain; nothing is shown here.
   */
  const plain = $derived(!!invite && invite.url.startsWith('http://'));
  const tailscaleText = strings.phone.tailscale;
  let tailscale = $state<TailscaleStatus | null>(null);
  let serving = $state(false);
  let servingFailure = $state('');
  $effect(() => {
    const client = store.client;
    // A failure belongs to the plain link it tried to replace.
    if (!plain) { tailscale = null; servingFailure = ''; return; }
    if (!store.owner || store.connection !== 'ready' || !client) { tailscale = null; return; }
    let live = true;
    untrack(() => void client.call('tailscale.status', {}).then((status) => { if (live) tailscale = status; }, () => undefined));
    return () => { live = false; };
  });
  const offerTailscale = $derived(plain && tailscale?.state === 'off' && !!tailscale.url && lockedBy(store.policy, 'network.tailscaleServe') === null);

  async function serveThroughTailscale() {
    const client = store.client;
    if (!client || serving) return;
    serving = true;
    servingFailure = '';
    try {
      const status = await client.call('tailscale.enable', { replace: false });
      tailscale = status;
      // Served and made the public address: the next link names it.
      if (status.state === 'on') await store.addDevice();
      else servingFailure = status.detail ? tailscaleText.details[status.detail] : tailscaleText.error;
    } catch (reason) {
      servingFailure = errorText(reason);
    } finally {
      serving = false;
    }
  }
</script>

{#if invite}
  <div class="add-device" data-testid="add-device" data-link={invite.url}>
    {#if qr && !loopback}
      <div class="qr" data-testid="add-device-qr" role="img" aria-label={strings.group.qr}>{@html qr}</div>
    {/if}
    <div class="text">
      {#if !loopback}
        <p class="title">{strings.group.scanTitle}</p>
        <p class="hint">{strings.group.addHint}</p>
        <p class="hint">{fill(strings.group.expires, { time: time(invite.expiresAt) })}</p>
      {/if}
      <label class="link-label" for="{uid}-link">{strings.group.link}</label>
      <input id="{uid}-link" class="mono link" data-testid="add-device-link" readonly spellcheck="false" autocomplete="off" bind:this={linkInput}
        value={invite.url} onfocus={(event) => event.currentTarget.select()} />
      <div class="buttons">
        <button type="button" data-testid="add-device-copy" onclick={() => void copy()}>
          {#if copied}<Check size={14} />{strings.group.copied}{:else}<Copy size={14} />{strings.group.copyLink}{/if}
        </button>
        <button type="button" class="ghost icon-only" data-testid="add-device-close" aria-label={strings.common.close} title={strings.common.close} onclick={() => store.closeDeviceInvite()}><X size={15} /></button>
      </div>
      {#if offerTailscale || servingFailure}
        <div class="tailscale" data-testid="add-device-tailscale">
          {#if offerTailscale}
            <p class="hint">{fill(strings.group.tailscale.hint, { url: tailscale?.url ?? '' })}</p>
            <button type="button" class="primary" data-testid="add-device-tailscale-enable" disabled={serving} onclick={() => void serveThroughTailscale()}>
              <ShieldCheck size={14} />{serving ? strings.group.tailscale.enabling : strings.group.tailscale.enable}
            </button>
          {/if}
          {#if servingFailure}<p class="hint error" role="alert">{servingFailure}</p>{/if}
          {#if tailscale?.detail === 'serve-consent' && tailscale.actionUrl}
            <a class="button" href={tailscale.actionUrl} target="_blank" rel="noreferrer">{tailscaleText.approve}</a>
          {/if}
        </div>
      {/if}
      <LanReach {store} {loopback} {firewall} />
    </div>
  </div>
  <FirewallNotice {store} bind:this={firewall} />
{/if}

<style>
  .add-device {
    display: flex;
    align-items: flex-start;
    gap: 18px;
    margin-top: 14px;
    padding: 16px;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }
  .qr {
    flex: none;
    width: 168px;
    height: 168px;
    padding: 10px;
    box-sizing: border-box;
    border-radius: var(--radius-md);
    /* A QR code reads dark on light whatever the theme: a camera needs the contrast. */
    background: white;
  }
  .qr :global(svg) { display: block; width: 100%; height: 100%; }
  .text { flex: 1; min-width: 0; display: grid; gap: 6px; align-content: start; }
  .title { margin: 0 0 2px; font-size: var(--text-base); font-weight: 600; color: var(--color-foreground); }
  .hint { margin: 0; }
  .buttons { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  .link-label { margin-top: 8px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .link { width: 100%; min-width: 0; font-size: var(--text-xs); }
  .icon-only { width: var(--control); padding: 0; color: var(--color-muted-foreground); }
  .tailscale { display: grid; gap: 6px; justify-items: start; margin-top: 8px; }
  .error { color: var(--color-danger); }
  a.button {
    display: inline-flex;
    align-items: center;
    height: var(--control);
    padding: 0 14px;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-foreground);
    text-decoration: none;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .add-device { animation: none; } }
  @media (max-width: 520px) {
    .add-device { flex-direction: column; align-items: center; text-align: center; }
    .buttons { justify-content: center; }
    .tailscale { justify-items: center; }
  }
</style>
