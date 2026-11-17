<script lang="ts">
  import { emailParts } from '@boite/contracts';

  /**
   * Text that may name an account: each email address in it is blurred, as on
   * the Accounts page, and shows under the pointer. Everything else reads as is.
   */
  let { text }: { text: string } = $props();
  const parts = $derived(emailParts(text));
</script>

{#each parts as part, index (index)}{#if part.email}<span class="private-email" data-testid="private-email">{part.text}</span>{:else}{part.text}{/if}{/each}
