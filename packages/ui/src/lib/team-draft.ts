/*
 * A team written by hand (`docs/internals/teams.md`, In the app): the bots the dialog
 * offers, why one cannot join, the checks the core makes before it, and the
 * calls that create the team or bring an existing one to what was written.
 * The members are bots of the machine that holds the team and of the other
 * machines of its group: a bot of a machine outside the group, or one on its
 * way to another machine, is shown and cannot be picked.
 */

import { TEAM_BRIEF_MAX, TEAM_MEMBERS_MAX, TEAM_NAME_MAX, teamMemberKey, type AgentProfile, type Team, type TeamMember } from '@boite/contracts';
import { botLeaving, botMoving, moveName } from './agent-move-flow';
import type { AgentsView } from './agents.svelte';
import { count } from './format';
import { GroupLinks } from './group-links.svelte';
import { fill, strings } from './strings';
import type { Machine } from './workspace.svelte';

/** One bot the dialog lists: picked or not, and the reason it cannot be, if any. */
export interface TeamChoice {
  /** What the draft holds and the core is told: the bot's id here, `<coreId>/<botId>` on another machine of the group. */
  key: string;
  botId: string;
  name: string;
  avatar: string;
  /** The bot's machine, when it is not the one holding the team. */
  machine?: string;
  /** Set when the bot cannot be picked: outside the group, moving, gone. A member that is gone can still be taken out. */
  reason: string | null;
  /** A member this machine no longer lists: picked it stays, unpicked it leaves the team on save. */
  gone?: true;
}

export interface TeamDraft { name: string; brief: string; members: readonly string[] }

/** A team's member as a draft holds it. */
export function draftKey(member: TeamMember): string {
  return member.machine ? teamMemberKey(member.coreId, member.botId) : member.botId;
}

/** The page's machine first, then its team's other members, then the others' bots, which a team takes from its group only. */
export function teamChoices(view: AgentsView, others: readonly { machine: Machine; view: AgentsView }[], team: Team | null): TeamChoice[] {
  const words = strings.teamChat.dialog;
  const live = (owner: AgentsView) => (owner.snapshot?.profiles ?? []).filter(profile => profile.status !== 'archived');
  const leaving = (owner: AgentsView, id: string) => botMoving(owner.store, id) || botLeaving(owner, id) !== null;
  const local = live(view).map((profile): TeamChoice => ({
    key: profile.id, botId: profile.id, name: profile.name, avatar: profile.avatar,
    reason: leaving(view, profile.id) ? words.moving : null,
  }));
  const members = team?.members ?? [];
  // A member this machine no longer lists (archived) stays shown, so it can be taken out.
  const gone = members.filter(member => !member.machine && !local.some(choice => choice.botId === member.botId)).map((member): TeamChoice => ({
    key: member.botId, botId: member.botId, name: member.name, avatar: '', reason: words.gone, gone: true,
  }));
  const group = view.store.group?.cores ?? [];
  const away = others.flatMap(({ machine, view: owner }) => {
    const coreId = GroupLinks.coreOf(machine);
    const near = coreId !== undefined && group.some(core => core.coreId === coreId) ? coreId : null;
    const name = moveName(machine);
    // A member whose machine left the group is one row, the one below, so it can still be taken out.
    return live(owner).filter(profile => near !== null || !members.some(member => member.coreId === coreId && member.botId === profile.id)).map((profile: AgentProfile): TeamChoice => ({
      key: near === null ? JSON.stringify([machine.id, profile.id]) : teamMemberKey(near, profile.id),
      botId: profile.id, name: profile.name, avatar: profile.avatar, machine: name,
      reason: near === null ? fill(words.otherMachine, { machine: name }) : leaving(owner, profile.id) ? words.moving : null,
    }));
  });
  // A member on a machine this app does not reach, or out of the group, is not among those: it stays shown under its last known name.
  const held = members.filter(member => member.machine && !away.some(choice => choice.key === draftKey(member))).map((member): TeamChoice => ({
    key: draftKey(member), botId: member.botId, name: member.name, avatar: '', ...(member.machine ? { machine: member.machine } : {}), reason: null,
  }));
  return [...local, ...gone, ...held, ...away];
}

/** What keeps the draft from being sent, and the field it is about. */
export interface DraftProblem { field: 'name' | 'taken' | 'members'; text: string }

/** The first problem in the order the form reads: the name, then the members. Null when the draft can go. */
export function draftProblem(draft: TeamDraft, teams: readonly Team[], except: string | null): DraftProblem | null {
  const words = strings.teamChat.dialog;
  const name = draft.name.trim().replace(/\s+/g, ' ');
  if (!name) return { field: 'name', text: words.nameRequired };
  if (name.startsWith('@')) return { field: 'name', text: words.nameAt };
  if (teams.some(team => !team.archived && team.id !== except && team.name.toLowerCase() === name.toLowerCase())) return { field: 'taken', text: fill(words.nameTaken, { name }) };
  // A new team needs a bot; an existing one may be emptied, as the core allows, so an archived team whose members all left can be restored.
  if (draft.members.length === 0 && except === null) return { field: 'members', text: words.membersRequired };
  // The team stays on this machine, which needs a bot of its own in it: the core asks the same.
  if (except === null && draft.members.every(key => key.includes('/'))) return { field: 'members', text: words.localRequired };
  if (draft.members.length > TEAM_MEMBERS_MAX) return { field: 'members', text: fill(words.full, { max: count(TEAM_MEMBERS_MAX) }) };
  return null;
}

export const TEAM_LIMITS = { name: TEAM_NAME_MAX, brief: TEAM_BRIEF_MAX, members: TEAM_MEMBERS_MAX } as const;

/**
 * Creates the team on the page's machine, or brings `team` to the draft: its
 * name and brief, then the members taken out, then the new ones, each with the
 * owner method the core already has. The changes are worked out against the
 * team as the core holds it now, not as the dialog opened it, so a retry after
 * a refusal sends only what is still missing. A refusal stops there and
 * throws; what went before it stays done, and `teams.changed` shows it.
 */
export async function saveTeam(view: AgentsView, team: Team | null, draft: TeamDraft): Promise<Team> {
  const client = view.store.client;
  if (!client) throw new Error(strings.connection.unavailable);
  const name = draft.name.trim().replace(/\s+/g, ' ');
  const brief = draft.brief.trim();
  if (!team) return client.call('teams.create', { name, ...(brief ? { brief } : {}), members: [...draft.members] });
  const { teams } = await client.call('teams.list', { archived: true });
  const current = teams.find(entry => entry.id === team.id);
  if (!current) throw new Error(fill(strings.teamChat.dialog.vanished, { team: team.name }));
  let saved = current;
  const change = { ...(name !== current.name ? { name } : {}), ...(brief !== current.brief ? { brief } : {}) };
  if (Object.keys(change).length > 0) saved = await client.call('teams.update', { teamId: current.id, ...change });
  // Out first: a full team makes room before the new members come in.
  for (const member of current.members) {
    if (!draft.members.includes(draftKey(member))) saved = await client.call('teams.members.remove', { teamId: current.id, botId: member.key });
  }
  for (const key of draft.members) {
    if (!current.members.some(member => draftKey(member) === key)) saved = await client.call('teams.members.add', { teamId: current.id, botId: key });
  }
  return saved;
}
