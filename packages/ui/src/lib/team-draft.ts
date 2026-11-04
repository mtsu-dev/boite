/*
 * A team written by hand (`docs/teams.md`, In the app): the bots the dialog
 * offers, why one cannot join, the checks the core makes before it, and the
 * calls that create the team or bring an existing one to what was written.
 * The members are bots of the machine that holds the team: a bot of another
 * machine, or one on its way there, is shown and cannot be picked.
 */

import { TEAM_BRIEF_MAX, TEAM_MEMBERS_MAX, TEAM_NAME_MAX, type AgentProfile, type Team } from '@boite/contracts';
import { botLeaving, botMoving, moveName } from './agent-move-flow';
import type { AgentsView } from './agents.svelte';
import { count } from './format';
import { fill, strings } from './strings';
import type { Machine } from './workspace.svelte';

/** One bot the dialog lists: picked or not, and the reason it cannot be, if any. */
export interface TeamChoice {
  /** The bot id; another machine's bot is keyed by its machine too, ids can collide. */
  key: string;
  botId: string;
  name: string;
  avatar: string;
  /** Set when the bot cannot be picked: on another machine, moving, gone. A member that is gone can still be taken out. */
  reason: string | null;
}

export interface TeamDraft { name: string; brief: string; members: readonly string[] }

/** The page's machine first, then the others' bots, which a team of this version cannot take. */
export function teamChoices(view: AgentsView, others: readonly { machine: Machine; view: AgentsView }[], team: Team | null): TeamChoice[] {
  const live = (owner: AgentsView) => (owner.snapshot?.profiles ?? []).filter(profile => profile.status !== 'archived');
  const local = live(view).map((profile): TeamChoice => ({
    key: profile.id, botId: profile.id, name: profile.name, avatar: profile.avatar,
    reason: botMoving(view.store, profile.id) || botLeaving(view, profile.id) ? strings.teamChat.dialog.moving : null,
  }));
  // A member this machine no longer lists (archived, moved away) stays shown, so it can be taken out.
  const gone = (team?.members ?? []).filter(member => !local.some(choice => choice.botId === member.botId)).map((member): TeamChoice => ({
    key: member.botId, botId: member.botId, name: member.name, avatar: '', reason: strings.teamChat.dialog.gone,
  }));
  const away = others.flatMap(({ machine, view: owner }) => live(owner).map((profile: AgentProfile): TeamChoice => ({
    key: JSON.stringify([machine.id, profile.id]), botId: profile.id, name: profile.name, avatar: profile.avatar,
    reason: fill(strings.teamChat.dialog.otherMachine, { machine: moveName(machine) }),
  })));
  return [...local, ...gone, ...away];
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
  if (draft.members.length === 0) return { field: 'members', text: words.membersRequired };
  if (draft.members.length > TEAM_MEMBERS_MAX) return { field: 'members', text: fill(words.full, { max: count(TEAM_MEMBERS_MAX) }) };
  return null;
}

export const TEAM_LIMITS = { name: TEAM_NAME_MAX, brief: TEAM_BRIEF_MAX, members: TEAM_MEMBERS_MAX } as const;

/**
 * Creates the team on the page's machine, or brings `team` to the draft: its
 * name and brief, then the members taken out, then the new ones, each with the
 * owner method the core already has. A refusal stops there and throws; what
 * went before it stays done, and `teams.changed` shows it.
 */
export async function saveTeam(view: AgentsView, team: Team | null, draft: TeamDraft): Promise<Team> {
  const client = view.store.client;
  if (!client) throw new Error(strings.connection.unavailable);
  const name = draft.name.trim().replace(/\s+/g, ' ');
  const brief = draft.brief.trim();
  if (!team) return client.call('teams.create', { name, ...(brief ? { brief } : {}), members: [...draft.members] });
  let saved = team;
  const change = { ...(name !== team.name ? { name } : {}), ...(brief !== team.brief ? { brief } : {}) };
  if (Object.keys(change).length > 0) saved = await client.call('teams.update', { teamId: team.id, ...change });
  // Out first: a full team makes room before the new members come in.
  for (const member of team.members) {
    if (!draft.members.includes(member.botId)) saved = await client.call('teams.members.remove', { teamId: team.id, botId: member.botId });
  }
  for (const botId of draft.members) {
    if (!team.members.some(member => member.botId === botId)) saved = await client.call('teams.members.add', { teamId: team.id, botId });
  }
  return saved;
}
