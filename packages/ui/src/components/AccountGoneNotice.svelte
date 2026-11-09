<script lang="ts">
  import { UserX } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  import ThreadNotice from './ThreadNotice.svelte';

  /*
   * Over the composer of a conversation whose account was removed, with no other
   * account of its agent to move to: the box only locks its field, so this line
   * says why once and holds the one remedy, the model chip's list of models on
   * other accounts. A bot's thread has its own banner (agents/AgentProblem.svelte).
   */
  let { onpick }: { onpick: () => void } = $props();
</script>

<ThreadNotice icon={UserX} tone="live" testid="composer-account-removed" title={strings.accounts.removed} info={strings.accounts.removedHint} docked replaces>
  {#snippet actions()}
    <button type="button" class="small" data-testid="account-gone-pick" onclick={onpick}><span class="ui-label">{strings.agents.pickAccount}</span></button>
  {/snippet}
</ThreadNotice>
