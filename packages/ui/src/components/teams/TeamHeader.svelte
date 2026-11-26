<script module lang="ts">
  import { markFeature } from '@boite/contracts';
  markFeature('boite-feature:teams');
</script>

<script lang="ts">
  import { ArrowLeft, ChevronDown, Ellipsis } from '@lucide/svelte';
  import type { AgentProfile, Team, Thread } from '@boite/contracts';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { count } from '../../lib/format';
  import type { Store } from '../../lib/store.svelte';
  import { fill, strings } from '../../lib/strings';
  import { pickTeamAction, teamMenuItems } from '../../lib/team-menu';
  import type { Machine } from '../../lib/workspace.svelte';
  import AgentAvatar from '../agents/AgentAvatar.svelte';
  import { avatarLit } from '../../lib/avatar-lit';
  import Menu from '../Menu.svelte';
  import TeamDialog from './TeamDialog.svelte';

  /**
   * The head of a team's chat, in a bot header's two shapes (`AgentHeader`).
   * A desktop draws it in the window's top bar: the name, the chevron of its
   * menu, then "Team chat · N bots and you" (or that it is paused or
   * archived). A phone draws it over the chat, with the way back and the
   * members' pictures. Its menu is the team's (`lib/team-menu.ts`), the one its
   * picture in the window's rail opens.
   */
  let { store, view, others = [], thread, team, onback }: {
    store: Store;
    /** The page's machine, which holds the team. */
    view: AgentsView;
    others?: readonly { machine: Machine; view: AgentsView }[];
    thread: Thread;
    team: Team | null;
    /** A phone's way back to the list. */
    onback?: () => void;
  } = $props();

  const labels = $derived(strings.teamChat);
  let editing = $state(false);
  let busy = $state(false);

  /** The members as pictures: a bot of this machine's own once its agents are read, else the robot its id picks. */
  const pictures = $derived((team?.members ?? []).map((member): Pick<AgentProfile, 'id' | 'name' | 'avatar'> =>
    (member.machine ? undefined : view.snapshot?.profiles.find(profile => profile.id === member.botId)) ?? { id: member.botId, name: member.name, avatar: '' }));
  const members = $derived(team?.members.length ?? 0);
  const room = $derived(team?.archived ? labels.archivedShort : team?.paused ? labels.pausedShort
    : members === 0 ? labels.room : fill(members === 1 ? labels.roomOne : labels.roomMany, { count: count(members) }));

  const items = $derived(team ? teamMenuItems(store, team) : []);

  async function pick(id: string) {
    const current = team;
    if (!current || !store.owner) return;
    if (id === 'edit') { editing = true; return; }
    if (busy) return;
    busy = true;
    try { await pickTeamAction(store, current, id); } finally { busy = false; }
  }
</script>

<header class="agent-head team-head" class:compact={!onback} data-testid="team-header" data-paused={team?.paused ? 'true' : undefined} data-archived={team?.archived ? 'true' : undefined}>
  {#if onback}
    <button type="button" class="ghost icon agent-mobile-back" aria-label={strings.agents.list} title={strings.agents.list} onclick={onback} data-testid="agent-back"><ArrowLeft size={18} strokeWidth={1.75} /></button>
    <span class="team-head-identity">
      <span class="agent-head-robot"><AgentAvatar kind="team" id={team?.id ?? thread.id} name={team?.name ?? thread.title} members={pictures} size={36} lit={avatarLit({ open: true })} /></span>
      <span class="agent-head-text">
        <strong data-testid="team-title">{team?.name ?? thread.title}</strong>
        <span class="agent-live"><span class="agent-live-text" data-testid="team-room">{room}</span></span>
      </span>
    </span>
    {#if items.length}
      <nav class="agent-head-actions" aria-label={team?.name ?? thread.title}>
        <Menu placement="bottom" align="end" variant="ghost" label={labels.menu} heading={team?.name ?? thread.title} testid="team-menu" disabled={busy} {items} onpick={pick}>
          <Ellipsis size={18} strokeWidth={1.75} />
        </Menu>
      </nav>
    {/if}
  {:else}
    <!-- A thread header's grammar: the title, the chevron of its menu, then one quiet line of state. -->
    <span class="team-head-name"><strong data-testid="team-title">{team?.name ?? thread.title}</strong></span>
    {#if items.length}
      <span class="agent-head-menu">
        <Menu placement="bottom" variant="text" label={labels.menu} heading={team?.name ?? thread.title} testid="team-menu" disabled={busy} {items} onpick={pick}>
          <ChevronDown size={16} />
        </Menu>
      </span>
    {/if}
    <span class="team-head-room" data-testid="team-room">{room}</span>
  {/if}
</header>

{#if editing && team}
  <TeamDialog {view} {others} {team} onclose={() => { editing = false; }} ondone={() => {}} />
{/if}

<style>
  /* In the window's bar the name starts where a thread's title does, in its weight; the room's line follows in the meta ink. */
  .team-head.compact { gap: 0; }
  .team-head-name { display: flex; align-items: center; flex: 0 1 auto; min-width: 0; height: var(--control); }
  .team-head-name strong { overflow: hidden; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
  .team-head-room { flex: 0 1 auto; min-width: 0; margin-left: 6px; overflow: hidden; color: var(--color-muted-foreground); font-size: var(--text-sm); text-overflow: ellipsis; white-space: nowrap; }
</style>
