<script lang="ts">
  import { MessageSquare } from '@lucide/svelte';
  import type { AgentProfile, Team } from '@boite/contracts';
  import { liveActivity, statusOf, type AgentsView } from '../../lib/agents.svelte';
  import { strings } from '../../lib/strings';
  import AgentAvatar from './AgentAvatar.svelte';
  import BotWorkList from './BotWorkList.svelte';

  /**
   * The selected bot's column on a desktop, under its head: its conversation,
   * then the threads it handles and the ones it is done with. A team shows its
   * chat, then its members, each opening its bot. The bots themselves are
   * listed in the window's rail.
   */
  let { view, agent = null, team = null, conversation, onconversation, onmember }: {
    view: AgentsView;
    agent?: AgentProfile | null;
    team?: Team | null;
    /** The conversation is what the card beside shows. */
    conversation: boolean;
    onconversation: () => void;
    onmember: (botId: string) => void;
  } = $props();

  const labels = $derived(strings.agents);
  const members = $derived((team?.members ?? []).map(member => {
    const profile = member.machine ? undefined : view.snapshot?.profiles.find(p => p.id === member.botId);
    const status = profile ? statusOf(view.snapshot, profile.id) : null;
    const line = status?.state === 'working' ? liveActivity(status, null)?.text ?? labels.state.working
      : status && status.state !== 'idle' ? labels.state[status.state] : profile?.domain ?? member.machine ?? '';
    return { member, profile: profile ?? { id: member.botId, name: member.name, avatar: '' }, line, working: status?.state === 'working' };
  }));
</script>

<div class="bot-column" data-testid="bot-column">
  {#if agent || team}
    <button type="button" class="bot-nav" class:selected={conversation} aria-current={conversation ? 'page' : undefined} onclick={onconversation} data-testid="bot-conversation">
      <MessageSquare size={16} strokeWidth={1.75} /><span>{labels.deskPanel.conversation}</span>
    </button>
  {/if}
  {#if agent}
    <BotWorkList {view} agentId={agent.id} />
  {:else if team}
    <h3 class="bot-section">{strings.teamChat.members} <span class="bot-section-count">{team.members.length}</span></h3>
    {#each members as { member, profile, line, working } (member.botId + (member.machine ?? ''))}
      <button type="button" class="bot-member" disabled={!!member.machine} onclick={() => onmember(member.botId)} data-testid="bot-member">
        <AgentAvatar kind="profile" id={profile.id} name={profile.name} avatar={profile.avatar} size={20} status={working ? 'running' : 'idle'} />
        <span class="bot-member-text"><strong>{profile.name}</strong>{#if line}<span>{line}</span>{/if}</span>
      </button>
    {/each}
  {/if}
</div>
