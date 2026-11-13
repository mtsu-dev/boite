<script lang="ts">
  import CardScope from './CardScope.svelte';
  import ConversationSwitches from './ConversationSwitches.svelte';
  import { strings } from '../lib/strings';

  /** How this device lists its threads (`list`) or shows a conversation (`conversation`): one card each; `phone` keeps the switches a phone has. */
  let { part, phone = false }: { part: 'list' | 'conversation'; phone?: boolean } = $props();
</script>

{#if part === 'list'}
  <section class="card" id="settings-thread-list" data-testid="settings-card-thread-list">
    <h2><span class="ui-label">{strings.settings.threadList}</span><CardScope /></h2>
    <ConversationSwitches part="list" />
  </section>
{:else}
  <section class="card" id="settings-conversations" data-testid="settings-card-conversation">
    <h2><span class="ui-label">{strings.settings.inConversation}</span><CardScope /></h2>
    <ConversationSwitches part="conversation" {phone} />
  </section>
{/if}
