<script lang="ts">
  import type { AgentProfile } from '@boite/contracts';
  import { avatarLit } from '../lib/avatar-lit';
  import AgentAvatar from './agents/AgentAvatar.svelte';

  let { bot, open = false, attention }: { bot: AgentProfile; open?: boolean; attention: boolean } = $props();
</script>

<span class="bot" title={bot.name} data-testid="thread-bot">
  <AgentAvatar kind="profile" id={bot.id} name={bot.name} avatar={bot.avatar} size={14} lit={avatarLit({ open, attention })} />
  <span>{bot.name}</span>
</span>

<style>
  .bot {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
  }
  .bot > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
