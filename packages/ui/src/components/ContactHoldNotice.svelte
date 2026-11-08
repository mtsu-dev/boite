<script lang="ts">
  import { MailWarning } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import ThreadNotice from './ThreadNotice.svelte';

  /*
   * In the composer's place on a thread whose history read contact mail sent
   * outside a shared project: the core refuses every turn there until the
   * owner trusts that history. One line and the way out; who wrote sits
   * behind the "i". A paired phone cannot trust it and is told where to.
   */
  let { store, threadId, contacts }: { store: Store; threadId: string; contacts: string[] } = $props();
  const t = $derived(strings.sidebar.contactHold);
  let trusting = $state(false);

  async function trust() {
    trusting = true;
    try { await store.trustContactHistory(threadId); } finally { trusting = false; }
  }
</script>

<ThreadNotice icon={MailWarning} tone="live" testid="contact-hold" title={t.title} detail={store.owner ? undefined : t.ownerOnly}
  info={`${fill(t.body, { contacts: contacts.join(', ') })} ${store.owner ? t.trustTip : ''}`.trim()} docked replaces>
  {#snippet actions()}
    {#if store.owner}<button type="button" class="small" data-testid="contact-hold-trust" disabled={trusting} onclick={trust}><span class="ui-label">{t.trust}</span></button>{/if}
  {/snippet}
</ThreadNotice>
