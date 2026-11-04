/**
 * Teams of bots, as `packages/core/src/teams/store.ts` keeps them: the same
 * checks, routing and visibility, posts in a team chat that runs no agent.
 * Nothing is delivered here: a post's bot recipients stay `waiting`.
 */
import {
  RpcErrorCode,
  routeTeamPost,
  teamMemberKey,
  teamPostVisible,
  TEAM_BRIEF_MAX,
  TEAM_MEMBERS_MAX,
  TEAM_NAME_MAX,
  TEAM_OWNER,
  TEAM_POST_MAX,
  type AgentProfile,
  type Team,
  type TeamAsk,
  type TeamAudience,
  type TeamDelivery,
  type TeamMember,
  type TeamParty,
  type TeamPost,
  type TeamPostRef,
  type Thread,
  type Turn
} from '@boite/contracts';
import { RpcFailure } from '../client';
import { DATA_DIR } from './shared';
import { askTeam } from './requests';
import { fakeCore } from './coordination';
import type { FakeContext, FakeMethods } from './context';

/** A bot a team may take: one of this machine, or of another machine of the group, with that machine's name. */
type FakeBot = AgentProfile & { coreId: string; machine?: string };
type PostInput = { id: unknown; author: TeamParty; text: unknown; audience: TeamAudience; to?: TeamParty[]; inReplyTo?: unknown };
/** How each fake core takes a post: a bot of another machine posts on the one holding its team. */
const posters = new WeakMap<FakeContext, (team: Team, input: PostInput) => TeamPost>();

const refused =(message: string, data: Record<string, unknown> = {}) => new RpcFailure({ code: RpcErrorCode.Refused, message, data });
const invalid = (message: string) => new RpcFailure({ code: RpcErrorCode.InvalidParams, message });

interface TeamState { teams: Map<string, Team>; posts: Map<string, TeamPost[]>; deliveries: TeamDelivery[] }
const states = new WeakMap<FakeContext, TeamState>();
function state(ctx: FakeContext): TeamState {
  let found = states.get(ctx);
  if (!found) states.set(ctx, found = { teams: new Map(), posts: new Map(), deliveries: [] });
  return found;
}

type TeamMethods = Pick<FakeMethods, `teams.${string}` & keyof FakeMethods>;

/** What would reach a provider on a thread: a team chat and a debate's salon run no agent, so each refuses there, as `requireAgent` (`packages/core/src/threads/agentless.ts`) does. */
const AGENT_METHODS = ['turns.start', 'turns.steer', 'turns.recover', 'threads.retitle', 'threads.compact', 'threads.rewind', 'threads.fork', 'threads.move',
  'threads.btw', 'threads.btw.fork', 'threads.update', 'threads.goal.track', 'threads.activity.set'] as const;

/** `methods` with each of `AGENT_METHODS` refusing a team chat and a debate's salon first. */
export function refuseTeamChats(ctx: FakeContext, methods: FakeMethods): FakeMethods {
  for (const name of AGENT_METHODS) {
    const answer = methods[name] as (params: { threadId: string }, ...rest: unknown[]) => Promise<unknown>;
    // Not async: an extra tick before the method would let a running fake turn end first.
    (methods as Record<string, unknown>)[name] = (params: { threadId: string }, ...rest: unknown[]) => {
      const thread = ctx.threads.get(params.threadId);
      if (thread?.teamId) return Promise.reject(refused('a team chat runs no agent; post to it through teams.post', { threadId: params.threadId }));
      if (thread?.debateId) return Promise.reject(refused('a debate\'s salon runs no agent; post to it through debates.post', { threadId: params.threadId }));
      return answer(params, ...rest);
    };
  }
  return methods;
}

export function teamMethods(ctx: FakeContext): TeamMethods {
  const self = () => ctx.identity.coreId;
  const key = (botId: string) => teamMemberKey(self(), botId);
  const gate = () => {
    const experiments = ctx.desktopExperiments ?? ctx.clientPreferences?.experiments ?? [];
    if (!experiments.includes('teams')) throw refused('teams need the Teams experiment, which is off in the desktop app (Settings, Experiments)', { reason: 'experiment-off' });
  };
  const all = () => [...state(ctx).teams.values()];
  const changed = (team: Team) => ctx.emit('teams.changed', { teamId: team.id, version: team.version });
  const save = (team: Team, change: Partial<Team>): Team => {
    const next = { ...team, ...change, version: team.version + 1, updatedAt: ctx.now() };
    state(ctx).teams.set(team.id, next);
    changed(next);
    return structuredClone(next);
  };
  const require = (teamId: unknown): Team => {
    const team = typeof teamId === 'string' ? state(ctx).teams.get(teamId) : undefined;
    if (!team) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `teamId: no team ${JSON.stringify(teamId)}`, data: { field: 'teamId' } });
    return team;
  };
  /** A bot among those of one machine, by id or by a name no other has. */
  const among = (live: AgentProfile[], wanted: string): AgentProfile | undefined => {
    const named = live.filter(agent => agent.name.toLowerCase() === wanted.toLowerCase());
    return live.find(agent => agent.id === wanted) ?? (named.length === 1 ? named[0] : undefined);
  };
  /** `<machine>/<bot>`: the other machine answers for its bot, as `team.bot` does, and its own switch lets it in or not. The fake keeps no mirror on that machine. */
  const distant = (wanted: string, field: string): FakeBot => {
    const slash = wanted.indexOf('/');
    const machine = wanted.slice(0, slash).trim();
    const name = wanted.slice(slash + 1).trim();
    if (!machine || !name) throw invalid(`${field}: expected <machine>/<bot>`);
    if (ctx.roster === null) throw refused(`${field}: this machine is in no group, so ${JSON.stringify(wanted)} names no bot`, { field });
    const peer = ctx.roster.cores.find(core => core.coreId === machine) ?? ctx.roster.cores.find(core => core.name.toLowerCase() === machine.toLowerCase());
    if (!peer) throw refused(`${field}: no machine ${machine} in this group`, { field });
    if (peer.coreId === self()) {
      const here = among(ctx.agents.liveProfiles(), name);
      if (!here) throw refused(`${field}: no bot ${JSON.stringify(name)}`, { field });
      return { ...here, coreId: self() };
    }
    const there = fakeCore(peer.coreId);
    if (!there) throw refused(`${field}: ${peer.name} did not answer; its bots can join once it answers`, { field, reason: 'unreachable' });
    if (!(there.desktopExperiments ?? there.clientPreferences?.experiments ?? []).includes('teams')) {
      throw refused(`${peer.name}: teams need the Teams experiment, which is off in the desktop app (Settings, Experiments)`, { field, reason: 'experiment-off' });
    }
    const found = among(there.agents.liveProfiles(), name);
    if (!found) throw refused(`${peer.name}: bot: no bot ${JSON.stringify(name)}`, { field, reason: 'peer-refused' });
    return { ...found, coreId: peer.coreId, machine: peer.name };
  };
  const bot = (ref: unknown, field = 'members'): FakeBot => {
    const wanted = typeof ref === 'string' ? ref.trim() : '';
    if (!wanted) throw invalid(`${field}: expected a bot name or id`);
    const local = among(ctx.agents.liveProfiles(), wanted);
    if (local) return { ...local, coreId: self() };
    if (wanted.includes('/')) return distant(wanted, field);
    throw refused(`${field}: no bot ${JSON.stringify(wanted)}`, { field });
  };
  /** A team's own word for a bot: its id here, `<coreId>/<botId>` elsewhere. */
  const refOf = (entry: FakeBot) => (entry.coreId === self() ? entry.id : teamMemberKey(entry.coreId, entry.id));
  const memberOf = (entry: FakeBot, joinedSeq: number): TeamMember => ({
    key: teamMemberKey(entry.coreId, entry.id), coreId: entry.coreId, botId: entry.id, name: entry.name, joinedSeq, ...(entry.machine ? { machine: entry.machine } : {})
  });
  /** A bot's id here counts from this fake machine's seed, so another machine's bot may share it: a member is the bot and its machine. */
  const isMember = (team: Team, entry: FakeBot) => team.members.some(member => member.key === teamMemberKey(entry.coreId, entry.id));
  const labelOf = (entry: FakeBot) => (entry.machine ? `${entry.name} (${entry.machine})` : entry.name);
  const bots = (refs: unknown): FakeBot[] => {
    if (!Array.isArray(refs) || refs.length === 0 || refs.length > TEAM_MEMBERS_MAX) throw invalid(`members: expected 1 to ${TEAM_MEMBERS_MAX} bots`);
    const found = refs.map(ref => bot(ref));
    return found.filter((entry, index) => found.findIndex(other => other.id === entry.id && other.coreId === entry.coreId) === index);
  };
  const checkName = (value: unknown, except?: string): string => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > TEAM_NAME_MAX) throw invalid(`name: expected 1 to ${TEAM_NAME_MAX} characters`);
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.startsWith('@')) throw invalid('name: a team name does not start with @');
    if (all().some(team => !team.archived && team.id !== except && team.name.toLowerCase() === name.toLowerCase())) throw refused(`name: a team is already named ${JSON.stringify(name)}`, { field: 'name' });
    return name;
  };
  const checkBrief = (value: unknown): string => {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > TEAM_BRIEF_MAX) throw invalid(`brief: expected at most ${TEAM_BRIEF_MAX} characters`);
    return value.trim();
  };
  const caller = (threadId: unknown): AgentProfile => {
    const found = ctx.agents.liveProfiles().find(agent => typeof threadId === 'string' && ctx.agents.conversationOf(agent.id) === threadId);
    if (!found) throw refused('threadId: teams are for bots; this thread is no bot\'s conversation', { field: 'threadId' });
    return found;
  };
  const named = (ref: unknown, member: TeamParty, pool = all()): Team => {
    const wanted = typeof ref === 'string' ? ref.trim() : '';
    if (!wanted) throw invalid('team: expected a team name or id');
    const mine = pool.filter(team => member === TEAM_OWNER || team.members.some(entry => entry.key === member));
    const found = mine.find(team => team.id === wanted) ?? mine.find(team => !team.archived && team.name.toLowerCase() === wanted.toLowerCase());
    if (!found) throw refused(`team: no team ${JSON.stringify(wanted)}`, { field: 'team' });
    return found;
  };
  /** What a bot may name: the teams held here and those another machine of the group holds, where the real core keeps a mirror. */
  const reachable = (): Team[] => [...all(), ...(ctx.roster?.cores ?? []).flatMap(core => {
    const there = core.coreId === self() ? undefined : fakeCore(core.coreId);
    return there ? [...state(there).teams.values()] : [];
  })];
  /** The machine holding a team, which keeps its posts. */
  const holderOf = (team: Team): FakeContext => (team.host === self() ? ctx : fakeCore(team.host) ?? ctx);
  const mine = (threadId: unknown, ref: unknown) => {
    const agent = caller(threadId);
    return { agent, member: key(agent.id), team: named(ref, key(agent.id), reachable()) };
  };
  const card = (id: unknown, kind: TeamAsk['kind']): TeamAsk => {
    const ask = typeof id === 'string' ? ctx.pendingQuestions.get(id)?.request.team : undefined;
    if (ask === undefined || ask.kind !== kind) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `card: ${String(id)} is no open team ${kind} card`, data: { field: 'card' } });
    return ask;
  };
  const settle = (id: string | undefined, text: string) => {
    if (id === undefined) return;
    const pending = ctx.pendingQuestions.get(id);
    ctx.pendingQuestions.delete(id);
    pending?.resolve({ optionIds: [], text });
  };
  const draw = (threadId: string, text: string, team: TeamAsk) => {
    const thread = ctx.thread(threadId);
    if (thread.archived) throw refused('cannot ask on an archived thread', { threadId });
    const turn = thread.turns.find(entry => entry.status === 'running') ?? thread.turns.at(-1);
    if (!turn) throw refused('the thread has no turn to ask in yet', { threadId });
    if ([...ctx.pendingQuestions.values()].some(pending => pending.request.threadId === threadId && JSON.stringify(pending.request.team) === JSON.stringify(team))) {
      throw refused('the same card is already open in this thread; the owner has not answered it yet', { field: 'card' });
    }
    return { questionId: askTeam(ctx, thread, turn, text, team) };
  };

  /** One post: kept once by its id, routed, and shown in the team chat as a turn of its own. */
  const post = (team: Team, input: PostInput): TeamPost => {
    const holder = holderOf(team);
    if (holder !== ctx) return posters.get(holder)!(team, input);
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id || id.length > 100) throw invalid('id: expected 1 to 100 characters');
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > TEAM_POST_MAX) throw invalid(`text: expected 1 to ${TEAM_POST_MAX} characters`);
    const inReplyTo = input.inReplyTo === undefined || input.inReplyTo === null ? null : String(input.inReplyTo);
    const to = input.audience === 'private' ? [...new Set(input.to ?? [])] : [...new Set(input.to ?? [])].sort();
    const fingerprint = JSON.stringify([input.author, input.audience, to, text, inReplyTo]);
    const posts = [...state(ctx).posts.values()].flat();
    const known = posts.find(entry => entry.id === id);
    if (known) {
      if (known.teamId !== team.id || known.fingerprint !== fingerprint) throw refused('id: already used for a different post', { field: 'id' });
      return structuredClone(known);
    }
    if (team.archived) throw refused(`${team.name} is archived`, { field: 'team' });
    const replied = inReplyTo === null ? null : posts.find(entry => entry.id === inReplyTo) ?? null;
    if (inReplyTo !== null && (!replied || replied.teamId !== team.id || !teamPostVisible(replied, input.author))) throw refused('inReplyTo: no post of this team you may read', { field: 'inReplyTo' });
    if (input.audience === 'private') {
      const recipient = to[0];
      if (to.length !== 1 || recipient === undefined) throw invalid('to: a private post has exactly one recipient');
      if (recipient === input.author) throw refused('to: a private post goes to someone else', { field: 'to' });
      if (recipient !== TEAM_OWNER && !team.members.some(member => member.key === recipient)) throw refused('to: the recipient is no member of the team', { field: 'to' });
    }
    const routing = routeTeamPost(team, { author: input.author, text, audience: input.audience, to, inReplyTo }, replied?.author ?? null);
    const now = ctx.now();
    const seq = team.lastSeq + 1;
    const saved: TeamPost = {
      id, teamId: team.id, seq, author: input.author, text, audience: input.audience, to: input.audience === 'private' ? to : routing.to, routedBy: routing.routedBy,
      why: null, inReplyTo, turnId: null, fingerprint, createdAt: now, ...(routing.notice ? { notice: routing.notice } : {})
    };
    state(ctx).posts.set(team.id, [...(state(ctx).posts.get(team.id) ?? []), saved]);
    state(ctx).teams.set(team.id, { ...team, lastSeq: seq });
    for (const recipient of saved.to) if (recipient !== TEAM_OWNER) state(ctx).deliveries.push({ postId: id, member: recipient, state: 'waiting', reason: null, at: now });
    const thread = ctx.thread(team.threadId);
    const turn: Turn = { id: `turn-team-${++ctx.seq}`, threadId: thread.id, status: 'done', queuedAt: now, startedAt: now, finishedAt: now, usage: null, error: null };
    const ref: TeamPostRef = { id, teamId: team.id, seq, author: saved.author, audience: saved.audience, to: saved.to, routedBy: saved.routedBy, inReplyTo, ...(saved.notice ? { notice: saved.notice } : {}) };
    const message = { id: `m-${++ctx.seq}`, threadId: thread.id, turnId: turn.id, role: input.author === TEAM_OWNER ? 'user' as const : 'assistant' as const, parts: [{ type: 'text' as const, text, teamPost: ref }], state: 'complete' as const, createdAt: now };
    thread.turns.push(turn);
    thread.messages.push(message);
    ctx.emitToThread(thread.id, 'message.started', structuredClone(message));
    ctx.emitToThread(thread.id, 'message.completed', { threadId: thread.id, messageId: message.id, state: 'complete' });
    // A bot's post is news in the team chat, as the core marks it; the owner's own is not.
    if (input.author !== TEAM_OWNER) thread.unread ||= !ctx.bus.subscribed.has(thread.id);
    ctx.touch(thread);
    changed(state(ctx).teams.get(team.id)!);
    return structuredClone(saved);
  };
  posters.set(ctx, post);
  /** With its machine's id: the machine holding the team takes posts from machines whose counters run alike. */
  const autoPostId = () => `post-${self()}-${++ctx.seq}`;
  /** A member by bot id, or by a name no other member has. */
  const member = (team: Team, ref: unknown, field = 'to') => {
    const wanted = typeof ref === 'string' ? ref.trim() : '';
    const slash = wanted.indexOf('/');
    const onMachine = (entry: TeamMember) => slash > 0 && entry.machine?.toLowerCase() === wanted.slice(0, slash).trim().toLowerCase() && entry.name.toLowerCase() === wanted.slice(slash + 1).trim().toLowerCase();
    const named = team.members.filter(entry => entry.name.toLowerCase() === wanted.toLowerCase() || onMachine(entry));
    const found = team.members.find(entry => entry.botId === wanted || entry.key === wanted) ?? (named.length === 1 ? named[0] : undefined);
    if (found) return found;
    throw refused(named.length > 1 ? `${field}: ${named.length} members are named ${JSON.stringify(wanted)}; name one by id: ${named.map(entry => entry.botId).join(', ')}`
      : `${field}: ${JSON.stringify(wanted)} is no member of ${team.name}`, { field });
  };

  return {
    'teams.list': async (params) => {
      gate();
      const reader = params?.threadId === undefined ? TEAM_OWNER : key(caller(params.threadId).id);
      const pool = reader === TEAM_OWNER ? all() : reachable();
      return { teams: structuredClone(pool.filter(team => (params?.archived === true || !team.archived) && (reader === TEAM_OWNER || team.members.some(entry => entry.key === reader)))) };
    },
    'teams.create': async (params) => {
      gate();
      const ask = params.card === undefined ? null : card(params.card, 'create');
      const name = checkName(params.name);
      const brief = checkBrief(params.brief);
      const members = bots(params.members);
      // With its machine's id: a bot may name the teams of several machines, whose counters run alike.
      const id = `team-${self()}-${++ctx.seq}`;
      const now = ctx.now();
      const first = members.find(entry => entry.coreId === self());
      if (!first) throw refused('members: name a bot of this machine; the team stays here and needs one of its own', { field: 'members' });
      const thread: Thread = { id: `t-${++ctx.seq}`, projectId: null, teamId: id, ...first.selection, title: name, titleSource: 'user', speed: null, cwd: `${DATA_DIR}/teams/${id}`, branch: null,
        status: 'idle', unread: false, archived: false, pinned: false, sessionId: null, sessionGeneration: 0, selectionVersion: 0, load: null, context: null,
        createdAt: now, updatedAt: now, messages: [], messagesBefore: null, turns: [], commands: [] };
      ctx.threads.set(thread.id, thread);
      ctx.touch(thread);
      const team: Team = {
        id, host: self(), version: 1, name, brief, members: members.map(entry => memberOf(entry, 0)),
        dispatcher: null, paused: false, archived: false, createdBy: ask === null ? TEAM_OWNER : key(ask.by), threadId: thread.id, lastSeq: 0, createdAt: now, updatedAt: now
      };
      state(ctx).teams.set(id, team);
      changed(team);
      settle(params.card, `applied: the team ${JSON.stringify(name)} exists, with ${team.members.map(entry => entry.name).join(', ')}`);
      return structuredClone(team);
    },
    'teams.update': async (params) => {
      gate();
      const team = require(params.teamId);
      const change: Partial<Team> = {};
      if (params.name !== undefined) change.name = checkName(params.name, team.id);
      if (params.brief !== undefined) change.brief = checkBrief(params.brief);
      const saved = save(team, change);
      if (change.name !== undefined) { const thread = ctx.thread(team.threadId); thread.title = change.name; ctx.touch(thread); }
      return saved;
    },
    'teams.archive': async (params) => {
      gate();
      const team = require(params.teamId);
      if (typeof params.archived !== 'boolean') throw invalid('archived: expected a boolean');
      if (team.archived === params.archived) return structuredClone(team);
      // As the core: a member this machine no longer has keeps the team archived until it is taken out.
      const gone = params.archived ? [] : team.members.filter(entry => ctx.agents.profileOf(entry.botId) === null);
      if (gone.length > 0) throw refused(`${team.name} has members on or going to another machine: ${gone.map(entry => entry.name).join(', ')}; remove them before restoring it, a team holds bots of one machine`, { field: 'teamId', reason: 'moving', members: gone.map(entry => entry.botId) });
      return save(team, { archived: params.archived });
    },
    'teams.pause': async (params) => {
      gate();
      const team = require(params.teamId);
      if (typeof params.paused !== 'boolean') throw invalid('paused: expected a boolean');
      return team.paused === params.paused ? structuredClone(team) : save(team, { paused: params.paused });
    },
    'teams.members.add': async (params) => {
      gate();
      const team = require(params.teamId);
      const ask = params.card === undefined ? null : card(params.card, 'invite');
      if (ask !== null && ask.kind === 'invite' && ask.teamId !== team.id) throw refused(`card: it asks about another team, ${ask.teamName}`, { field: 'card' });
      const agent = bot(params.botId, 'botId');
      if (team.archived) throw refused(`${team.name} is archived`, { field: 'teamId' });
      if (isMember(team, agent)) throw refused(`${agent.name} is already a member of ${team.name}`, { field: 'botId' });
      if (team.members.length >= TEAM_MEMBERS_MAX) throw refused(`a team holds at most ${TEAM_MEMBERS_MAX} bots`, { field: 'botId' });
      const saved = save(team, { members: [...team.members, memberOf(agent, team.lastSeq)] });
      settle(params.card, `applied: ${agent.name} joined ${team.name}`);
      return saved;
    },
    'teams.members.remove': async (params) => {
      gate();
      const team = require(params.teamId);
      const ask = params.card === undefined ? null : card(params.card, 'leave');
      if (ask !== null && ask.kind === 'leave' && ask.teamId !== team.id) throw refused(`card: it asks about another team, ${ask.teamName}`, { field: 'card' });
      const leaving = member(team, params.botId, 'botId');
      const saved = save(team, { members: team.members.filter(entry => entry.key !== leaving.key) });
      settle(params.card, `applied: ${leaving.name} left ${team.name}`);
      return saved;
    },
    'teams.post': async (params) => {
      gate();
      const team = require(params.teamId);
      const audience = params.audience ?? 'team';
      if (audience !== 'team' && audience !== 'private') throw invalid('audience: expected team or private');
      const to = (params.to ?? []).map(ref => member(team, ref).key);
      return post(team, { id: params.id, author: TEAM_OWNER, text: params.text, audience, to, inReplyTo: params.inReplyTo });
    },
    'teams.read': async (params) => {
      gate();
      const reader = params.threadId === undefined ? TEAM_OWNER : key(caller(params.threadId).id);
      const team = named(params.team, reader, reader === TEAM_OWNER ? all() : reachable());
      const limit = params.limit ?? 30;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid('limit: expected 1 to 100');
      const before = params.before ?? Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(before) || before < 1) throw invalid('before: expected a post number');
      const visible = (state(holderOf(team)).posts.get(team.id) ?? []).filter(entry => entry.seq < before && teamPostVisible(entry, reader));
      const posts = visible.slice(-limit);
      const ids = new Set(posts.map(entry => entry.id));
      const deliveries = reader === TEAM_OWNER ? state(ctx).deliveries.filter(entry => ids.has(entry.postId)) : [];
      return structuredClone({ team, posts, deliveries, more: visible.length > posts.length });
    },
    'teams.say': async (params) => {
      gate();
      const { team, member: author } = mine(params.threadId, params.team);
      return post(team, { id: params.id ?? autoPostId(), author, text: params.text, audience: 'team', inReplyTo: params.inReplyTo });
    },
    'teams.dm': async (params) => {
      gate();
      const { team, member: author } = mine(params.threadId, params.team);
      const wanted = typeof params.to === 'string' ? params.to.trim() : '';
      if (!wanted) throw invalid('to: expected a member or owner');
      const recipient = wanted.toLowerCase() === TEAM_OWNER ? TEAM_OWNER : member(team, wanted).key;
      return post(team, { id: params.id ?? autoPostId(), author, text: params.text, audience: 'private', to: [recipient] });
    },
    'teams.propose': async (params) => {
      gate();
      const agent = caller(params.threadId);
      const name = checkName(params.name);
      const brief = checkBrief(params.brief);
      const others = bots(params.members).filter(other => other.id !== agent.id || other.coreId !== self());
      if (others.length === 0) throw invalid('members: name at least one other bot');
      const members: FakeBot[] = [{ ...agent, coreId: self() }, ...others];
      return draw(params.threadId, `${agent.name} proposes the team ${JSON.stringify(name)}: ${members.map(labelOf).join(', ')}.${brief ? ` ${brief}` : ''}`,
        { kind: 'create', by: agent.id, name, brief, members: members.map(refOf) });
    },
    'teams.invite': async (params) => {
      gate();
      const { team, agent } = mine(params.threadId, params.team);
      const guest = bot(params.bot, 'bot');
      if (isMember(team, guest)) throw refused(`${guest.name} is already a member of ${team.name}`, { field: 'bot' });
      return draw(params.threadId, `${agent.name} asks to add ${labelOf(guest)} to the team ${JSON.stringify(team.name)}.`, { kind: 'invite', by: agent.id, teamId: team.id, teamName: team.name, botId: refOf(guest) });
    },
    'teams.leave': async (params) => {
      gate();
      const { team, agent } = mine(params.threadId, params.team);
      return draw(params.threadId, `${agent.name} asks to leave the team ${JSON.stringify(team.name)}.`, { kind: 'leave', by: agent.id, teamId: team.id, teamName: team.name, botId: agent.id });
    }
  };
}
