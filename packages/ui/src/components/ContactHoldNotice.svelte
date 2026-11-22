<script lang="ts">
  import { MailWarning } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import Notice from './Notice.svelte';

  /** With no turn hold, the notice sits above the active composer. */
  let { store, threadId, contacts }: { store: Store; threadId: string; contacts: string[] | null } = $props();
  const t = $derived(strings.sidebar.contactHold);
  let trusting = $state(false);

  async function trust() {
    trusting = true;
    try { await store.trustContactHistory(threadId); } finally { trusting = false; }
  }
</script>

<Notice icon={MailWarning} tone="caution" testid="contact-hold" title={contacts ? t.title : t.toolsTitle} detail={store.owner ? undefined : t.ownerOnly}
  info={`${contacts ? fill(t.body, { contacts: contacts.join(', ') }) : t.toolsBody} ${store.owner ? t.trustTip : ''}`.trim()} docked replaces={contacts !== null}>
  {#snippet actions()}
    {#if store.owner}<button type="button" class="small" data-testid="contact-hold-trust" disabled={trusting} onclick={trust}><span class="ui-label">{t.trust}</span></button>{/if}
  {/snippet}
</Notice>
