<script lang="ts">
  import { MailWarning } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';
  import NoticeBanner from './NoticeBanner.svelte';

  /*
   * Above the composer of a thread whose history read contact mail sent
   * outside a shared project. The core refuses every turn there until the
   * owner trusts that history; this says so before the send, with the way
   * out. A paired phone cannot trust it and is told where to.
   */
  let { store, threadId, contacts }: { store: Store; threadId: string; contacts: string[] } = $props();
  const t = $derived(strings.sidebar.contactHold);
  let trusting = $state(false);

  async function trust() {
    trusting = true;
    try { await store.trustContactHistory(threadId); } finally { trusting = false; }
  }
</script>

<NoticeBanner icon={MailWarning} tone="warning" testid="contact-hold" title={t.title} text={`${fill(t.body, { contacts: contacts.join(', ') })}${store.owner ? '' : ` ${t.ownerOnly}`}`}>
  {#snippet actions()}
    {#if store.owner}
      <button type="button" class="small" data-testid="contact-hold-trust" disabled={trusting} onclick={trust}><span class="ui-label">{t.trust}</span></button>
      <InfoTip topic={t.trust} text={t.trustTip} />
    {/if}
  {/snippet}
</NoticeBanner>
