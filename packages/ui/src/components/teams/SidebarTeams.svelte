<script lang="ts">
  import { ChevronRight, UsersRound } from '@lucide/svelte';
  import type { AgentProfile } from '@boite/contracts';
  import { agentDirectory, followAgentDirectories } from '../../lib/agent-directory.svelte';
  import { experimentOn } from '../../lib/experiments.svelte';
  import { count } from '../../lib/format';
  import { fill, strings } from '../../lib/strings';
  import { listNames, watchTeams, type TeamRow } from '../../lib/teams.svelte';
  import { workspace, type Machine } from '../../lib/workspace.svelte';
  import AgentAvatar from '../agents/AgentAvatar.svelte';
  import StatusMark from '../StatusMark.svelte';

  /**
   * The owner's teams at the top of the lists (`docs/teams.md`): one row per
   * team, its members' pictures, its name and who is in it, and the unread mark
   * of its chat. A row opens the chat. Every listed machine's teams show; the
   * section folds, remembers it, and leaves the list when no team exists.
   * `query` is the phone's search, lowercased.
   */
  let { machines, query = '', onopen }: { machines: readonly Machine[]; query?: string; onopen?: () => void } = $props();
  const labels = $derived(strings.teamChat);
  const FOLDED = 'boite.teams-folded';

  let open = $state(readOpen());
  function readOpen(): boolean {
    try { return localStorage.getItem(FOLDED) !== '1'; } catch { return true; }
  }
  function toggle() {
    open = !open;
    try { localStorage.setItem(FOLDED, open ? '0' : '1'); } catch { /* A private window keeps it for the session. */ }
  }

  const watched = watchTeams(() => machines);
  followAgentDirectories(() => machines.map(machine => machine.store), () => experimentOn('resident-agents'));
  const rows = $derived(watched().filter(row => matches(row, query)));
  const unread = $derived(rows.filter(row => row.chat?.unread).length);
  const multi = $derived(machines.length > 1);

  function matches({ machine, team }: TeamRow, needle: string): boolean {
    if (!needle) return true;
    return [team.name, machine.label, ...team.members.map(member => member.name)].some(text => text.toLowerCase().includes(needle));
  }
  /** The members as pictures: the bot's own when its machine's agents are read, else the robot its id picks. */
  function pictures({ machine, team }: TeamRow): Pick<AgentProfile, 'id' | 'name' | 'avatar'>[] {
    const profiles = agentDirectory(machine.store).snapshot?.profiles ?? [];
    return team.members.map(member => profiles.find(profile => profile.id === member.botId) ?? { id: member.botId, name: member.name, avatar: '' });
  }
  function show({ machine, team }: TeamRow) {
    onopen?.();
    void workspace.select(machine.store, team.threadId);
  }
</script>

{#if rows.length > 0}
  <section class="teams" data-testid="sidebar-teams">
    <div class="head">
      <button type="button" class="ghost toggle" aria-expanded={open} onclick={toggle} data-testid="sidebar-teams-toggle">
        <span class="mark"><UsersRound size={16} strokeWidth={1.75} /><span class="fold-caret" class:open aria-hidden="true"><ChevronRight size={16} /></span></span>
        <span class="title ui-label">{labels.heading}</span>
        <!-- Folded, the title alone says a chat waits unread; open, the rows say which. -->
        {#if unread && !open}<span class="unread ui-label" data-testid="sidebar-teams-unread" title={fill(labels.unread, { count: count(unread) })}>{count(unread)}</span>{/if}
      </button>
    </div>
    <div class="disclosure-fold" class:open inert={!open}>
      <div>
        {#each rows as row (`${row.machine.id}:${row.team.id}`)}
          {@const current = row.machine.store === workspace.active && row.machine.store.openThread?.id === row.team.threadId}
          {@const names = listNames(row.team.members.map(member => member.name))}
          <button type="button" class="ghost row" class:current class:unread={row.chat?.unread} aria-current={current ? 'page' : undefined}
            title={row.team.name} onclick={() => show(row)} data-testid="sidebar-team" data-team-id={row.team.id} data-unread={row.chat?.unread ? 'true' : undefined}>
            <span class="picture"><AgentAvatar kind="team" id={row.team.id} name={row.team.name} members={pictures(row)} size={24} /></span>
            <span class="text">
              <span class="name">{row.team.name}</span>
              <span class="detail" title={names}>{multi ? `${row.machine.label} · ${names}` : names}</span>
            </span>
            {#if row.chat?.unread}<StatusMark tone="unread" label={strings.sidebar.unread} />{/if}
          </button>
        {/each}
      </div>
    </div>
  </section>
{/if}

<style>
  /* The frame of a project section in Sidebar.svelte, as SidebarContacts draws it, so the three read as one list. */
  .teams {
    margin-bottom: 10px;
    padding: 4px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-surface-2) 55%, transparent);
  }
  .head { display: flex; align-items: center; gap: 2px; }
  .toggle { flex: 1; min-width: 0; height: var(--control-lg); padding: 0 4px; justify-content: flex-start; gap: 6px; }
  .mark { display: grid; flex: none; place-items: center; width: 22px; color: var(--color-muted-foreground); }
  .mark > :global(*) { grid-area: 1 / 1; transition: opacity var(--dur-2) var(--ease-out-quint), transform var(--dur-2) var(--ease-out-quint); }
  .mark .fold-caret { opacity: 0; }
  @media (hover: hover) {
    .head:hover .mark > :global(svg) { opacity: 0; }
    .head:hover .mark .fold-caret { opacity: 1; }
  }
  .toggle:focus-visible .mark > :global(svg) { opacity: 0; }
  .toggle:focus-visible .mark .fold-caret { opacity: 1; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; white-space: nowrap; font-weight: 600; color: var(--color-foreground); }
  .unread { flex: none; padding: 0 6px; border-radius: var(--radius-full); background: var(--color-active); color: var(--color-foreground); font-size: var(--text-xs); font-weight: 600; font-variant-numeric: tabular-nums; }
  .row { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; min-height: calc(var(--row) + 8px); padding: 4px 10px; border-radius: var(--radius-md); background: transparent; text-align: left; }
  .row:hover:not(:disabled) { background: var(--color-hover); }
  .row:active:not(:disabled) { transform: none; }
  .row.current { background: var(--color-active); }
  .picture { display: grid; flex: none; place-items: center; }
  .text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
  .name, .detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { color: var(--color-foreground); }
  .row.unread .name { font-weight: 600; }
  .detail { color: var(--color-subtle); font-size: var(--text-xs); }
  @media (prefers-reduced-motion: reduce) { .mark > :global(*) { transition: none; } }
  :global(html[data-motion='reduced']) .mark > :global(*) { transition: none; }
  /* A phone's list draws a project as a card under a shaded heading: the section follows it. */
  @media (max-width: 720px) {
    .teams { margin-bottom: 12px; padding: 0; background: var(--color-surface); overflow: hidden; }
    .head { padding-right: 4px; border-bottom: 1px solid var(--color-border); background: var(--color-surface-2); }
    .toggle { padding: 0 12px; }
    .title { color: var(--color-muted-foreground); font-size: var(--text-sm); }
    .row { min-height: var(--touch-target); padding: 6px 12px; border-radius: 0; }
    .row + .row { border-top: 1px solid var(--color-border); }
  }
</style>
