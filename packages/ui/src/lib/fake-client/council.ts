/**
 * Councils, as `packages/core/src/council/store.ts` keeps them: the same checks,
 * refusals and salon thread. Nothing runs here: the members get no thread and
 * never answer, so a round waits for Close this round or Stop.
 * `?fake=1&council=1` seeds a thread with a finished council, one under way and
 * a debate from before the council.
 */
import {
  COUNCIL_AUTHOR,
  COUNCIL_DEFAULT_EFFORT,
  COUNCIL_DEFAULT_MODELS,
  COUNCIL_EXPERIMENT,
  COUNCIL_LEGACY_SUMMARY,
  COUNCIL_LIMITS,
  COUNCIL_OWNER,
  COUNCIL_SYSTEM,
  councilHandles,
  councilMention,
  councilNames,
  councilNearestEffort,
  councilOver,
  councilSplitEffort,
  councilTable,
  RpcErrorCode,
  type Council,
  type CouncilMember,
  type CouncilPost,
  type CouncilReadOnly,
  type CouncilStatus,
  type Message,
  type Thread
} from '@boite/contracts';
import { RpcFailure } from '../client';
import { delegationConfig, pickModel } from './delegation';
import { toSummary } from './shared';
import { modelChoices } from './thread-models';
import type { FakeContext, FakeMethods } from './context';

type CouncilMethods = Pick<FakeMethods, `council.${string}` & keyof FakeMethods>;

const refused = (message: string, data: Record<string, unknown> = {}) => new RpcFailure({ code: RpcErrorCode.Refused, message, data });
const invalid = (message: string, data: Record<string, unknown>) => new RpcFailure({ code: RpcErrorCode.InvalidParams, message, data });

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field}: expected a non-empty string`, { field });
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(`${field}: ${trimmed.length} characters; the limit is ${max}`, { field, expected: `at most ${max} characters` });
  return trimmed;
}
function whole(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalid(`${field}: expected a whole number from ${min} to ${max}`, { field, expected: `${min}-${max}` });
  return value;
}

interface CouncilState {
  councils: Map<string, Council>;
  posts: Map<string, CouncilPost[]>;
  requests: Map<string, { id: string; fingerprint: string }>;
  rounds: Map<string, string>;
}
const states = new WeakMap<FakeContext, CouncilState>();
function state(ctx: FakeContext): CouncilState {
  let found = states.get(ctx);
  if (!found) states.set(ctx, found = { councils: new Map(), posts: new Map(), requests: new Map(), rounds: new Map() });
  return found;
}

function readOnlyOf(ctx: FakeContext, providerId: string): CouncilReadOnly {
  const capabilities = ctx.providers.find(provider => provider.id === providerId)?.capabilities;
  return capabilities?.planMode ? 'native' : capabilities?.approvals ? 'approvals' : 'none';
}

/** The salon: a projectless thread that runs no agent, on the parent's selection, as the core makes it. */
function salonOf(ctx: FakeContext, parent: Thread, councilId: string, request: string): Thread {
  const now = ctx.now();
  const thread: Thread = {
    id: `t-${++ctx.seq}`, projectId: null, councilId, title: `Council · ${request.replace(/\s+/g, ' ').slice(0, 100)}`, titleSource: 'user',
    providerId: parent.providerId, accountId: parent.accountId, model: parent.model, effort: parent.effort, speed: null, cwd: parent.cwd, branch: null, permissionMode: 'plan',
    status: 'idle', unread: false, archived: false, pinned: false, sessionId: null, sessionGeneration: 0, selectionVersion: 0, load: null, context: null,
    createdAt: now, updatedAt: now, messages: [], messagesBefore: null, turns: [], commands: []
  };
  ctx.threads.set(thread.id, thread);
  ctx.emit('thread.created', structuredClone(toSummary(thread)));
  return thread;
}

export function councilMethods(ctx: FakeContext): CouncilMethods {
  const gate = () => {
    const experiments = ctx.desktopExperiments ?? ctx.clientPreferences?.experiments ?? [];
    if (!experiments.includes(COUNCIL_EXPERIMENT)) throw refused('the council needs the Council experiment, which is off in the desktop app (Settings, Experiments)', { reason: 'experiment-off' });
  };
  const all = () => [...state(ctx).councils.values()].sort((a, b) => b.createdAt - a.createdAt);
  const postsOf = (id: string) => state(ctx).posts.get(id) ?? [];
  const require = (id: unknown): Council => {
    if (typeof id !== 'string' || !id) throw invalid('councilId: expected a council id', { field: 'councilId' });
    const council = state(ctx).councils.get(id);
    if (!council) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `council ${id} not found`, data: { councilId: id } });
    return council;
  };
  /** An agent reads and drives only the council its own thread started; the owner any. */
  const own = (council: Council, threadId: unknown) => {
    if (ctx.bus.principal === 'agent' && council.parentThreadId !== threadId) throw refused('a council answers only the thread that started it', { councilId: council.id });
  };
  const save = (council: Council, change: (draft: Council) => void): Council => {
    const next = structuredClone(council);
    change(next);
    next.version += 1;
    next.updatedAt = ctx.now();
    state(ctx).councils.set(next.id, next);
    ctx.emit('council.changed', { councilId: next.id, threadId: next.parentThreadId, salonThreadId: next.salonThreadId, version: next.version });
    return next;
  };
  const post = (council: Council, entry: Omit<CouncilPost, 'id' | 'councilId' | 'seq' | 'createdAt'> & { id?: string }): CouncilPost => {
    const list = state(ctx).posts.get(council.id) ?? [];
    const made: CouncilPost = { ...entry, id: entry.id ?? `cpo-${++ctx.seq}`, councilId: council.id, seq: list.length + 1, createdAt: ctx.now() };
    state(ctx).posts.set(council.id, [...list, made]);
    save(state(ctx).councils.get(council.id)!, () => undefined);
    return structuredClone(made);
  };
  const system = (council: Council, line: string) => post(council, { round: council.round, author: COUNCIL_SYSTEM, text: line, to: null, inReplyTo: null });

  const beginRound = (id: string, round: number) => {
    save(state(ctx).councils.get(id)!, draft => {
      draft.status = 'running';
      draft.round = round;
      draft.delivered = false;
      draft.roundDeadline = Date.now() + draft.timeoutMinutes * 60_000;
      for (const member of draft.members) member.pending = true;
    });
  };
  const end = (id: string, status: Exclude<CouncilStatus, 'running' | 'waiting'>, note: string | null): Council => {
    const ended = save(state(ctx).councils.get(id)!, draft => {
      draft.status = status;
      if (note) draft.note = note;
      draft.roundDeadline = null;
      draft.delivered = true;
      draft.finishedAt = ctx.now();
      for (const member of draft.members) member.pending = false;
    });
    if (note) system(ended, note);
    return state(ctx).councils.get(id)!;
  };

  // As the core: archiving the thread that started a council stops a round under way, and nothing goes back.
  ctx.bus.observe('thread.updated', thread => {
    if (!thread.archived || thread.parentThreadId || thread.councilId) return;
    for (const council of all()) if (council.parentThreadId === thread.id && council.status === 'running') end(council.id, 'stopped', 'The thread that started it was archived.');
  });

  return {
    'council.start': async (params) => {
      gate();
      const parent = ctx.thread(text(params?.threadId, 'threadId', 128));
      if (parent.parentThreadId) throw refused('a subagent cannot start a council; ask its parent', { threadId: parent.id });
      if (parent.teamId || parent.councilId) throw refused('a team chat or a council salon cannot start a council', { threadId: parent.id });
      if (parent.archived) throw refused('the thread is archived', { threadId: parent.id });
      const request = text(params.request, 'request', COUNCIL_LIMITS.requestChars);
      const named = params.models !== undefined && params.models !== null;
      if (named && !Array.isArray(params.models)) throw invalid('models: expected a list of provider/model routes', { field: 'models' });
      const models = named ? params.models!.map((model, index) => text(model, `models[${index}]`, 256)) : [...COUNCIL_DEFAULT_MODELS];
      if (models.length < COUNCIL_LIMITS.membersMin || models.length > COUNCIL_LIMITS.membersMax) {
        throw invalid(`models: expected ${COUNCIL_LIMITS.membersMin} to ${COUNCIL_LIMITS.membersMax} members, got ${models.length}`, { field: 'models', expected: `${COUNCIL_LIMITS.membersMin}-${COUNCIL_LIMITS.membersMax}` });
      }
      const timeoutMinutes = whole(params.timeoutMinutes, 'timeoutMinutes', 1, COUNCIL_LIMITS.timeoutMinutesMax, COUNCIL_LIMITS.timeoutMinutesDefault);
      const asked = params.effort !== undefined && params.effort !== null;
      const effort = asked ? text(params.effort, 'effort', 32) : COUNCIL_DEFAULT_EFFORT;
      const requestId = params.requestId === undefined ? null : text(params.requestId, 'requestId', 100);
      // Each member's own text, by its place in `models`; a key is a member as `models` writes it.
      const roles: (string | null)[] = models.map(() => null);
      if (params.roles !== undefined && params.roles !== null) {
        if (typeof params.roles !== 'object' || Array.isArray(params.roles)) throw invalid('roles: expected an object of member to text', { field: 'roles' });
        for (const [key, role] of Object.entries(params.roles)) {
          const index = models.findIndex(model => model.toLowerCase() === key.trim().toLowerCase());
          if (index < 0) throw invalid(`roles: ${key} is not a member; the members are ${models.join(', ')}`, { field: 'roles', expected: models.join(', ') });
          roles[index] = text(role, `roles.${key}`, COUNCIL_LIMITS.roleChars);
        }
      }
      const fingerprint = JSON.stringify([request, models, effort, timeoutMinutes, roles]);
      const known = requestId === null ? undefined : state(ctx).requests.get(`${parent.id}\n${requestId}`);
      if (known) {
        if (known.fingerprint !== fingerprint) throw refused('requestId already used for a different council', { field: 'requestId', expected: 'a fresh id' });
        return structuredClone(state(ctx).councils.get(known.id)!);
      }
      const config = delegationConfig(ctx, parent.id);
      if (config.enabled && config.paused) throw refused('this conversation\'s subagents are paused; resume them before a council', { threadId: parent.id });
      const warnings: string[] = [];
      const choices = modelChoices(ctx, parent);
      const routes = models.map((entry, index) => {
        const what = named ? `models[${index}]` : `default member ${entry}`;
        // `provider/model:effort` is that model at that level, unless the whole text is itself a listed route.
        const split = councilSplitEffort(entry);
        const whole = split !== null && choices.some(choice => `${choice.providerId}/${choice.model}`.toLowerCase() === entry.toLowerCase());
        const own = split !== null && !whole ? split.effort : null;
        const model = own === null ? entry : split!.model;
        let route: ReturnType<typeof pickModel>;
        try {
          route = pickModel(ctx, parent, config, model, undefined);
          // A route with a slash is that very provider/model, not one it is a part of.
          const head = model.slice(0, Math.max(0, model.indexOf('/')));
          if (head !== '' && route.id.toLowerCase() !== model.toLowerCase()) throw new Error(`${head} does not offer it; the nearest is ${route.id}`);
        } catch (error) {
          throw invalid(`${what}: ${error instanceof Error ? error.message : String(error)}. A council member is never replaced${named ? '' : '; name others with --models'}.`, { field: 'models', model });
        }
        const levels = choices.find(choice => `${choice.providerId}/${choice.model}` === route.id)?.efforts ?? [];
        // A level written on the member itself is that level or a refusal; the one shared by all falls to the nearest below.
        if (own !== null) {
          if (!levels.includes(own)) throw invalid(`${what}: ${levels.length > 0 ? `${route.id} has no ${own} effort; its levels are ${levels.join(', ')}` : `${route.id} takes no effort level; name it without :${own}`}. Nothing was started.`, { field: 'models', model: entry, expected: levels.join(', ') });
          return { ...route, effort: own };
        }
        if (levels.includes(effort)) return { ...route, effort };
        // A level a model lacks is said, not refused: its strongest below the one asked.
        const level = councilNearestEffort(levels, effort) ?? route.effort;
        if (asked || levels.length > 0) warnings.push(`${route.name} has no ${effort} effort, so it runs at ${level ?? 'its default'}.`);
        return { ...route, effort: level };
      });
      if (named) {
        const seen = new Map<string, number>();
        for (const [index, r] of routes.entries()) {
          const key = `${r.providerId}/${r.model}:${r.effort ?? ''}`.toLowerCase();
          const first = seen.get(key);
          if (first !== undefined) throw invalid(`models[${index}]: ${r.providerId}/${r.model}${r.effort ? ` at ${r.effort}` : ''} is already models[${first}]; the same model sits twice only at two efforts`, { field: 'models', model: models[index]! });
          seen.set(key, index);
        }
      }
      const names = councilNames(routes.map(r => r.name));
      const handles = councilHandles(names);
      const id = `cnl_${++ctx.seq}`;
      const members: CouncilMember[] = routes.map((r, index) => {
        const readOnly = readOnlyOf(ctx, r.providerId);
        const name = names[index]!;
        if (readOnly === 'approvals') warnings.push(`${name} has no read-only mode: Boite refuses every permission it asks.`);
        if (readOnly === 'none') warnings.push(`${name} has no read-only mode and asks no permission: it could change files.`);
        if (r.providerId === 'opencode') warnings.push(`${name} runs in OpenCode's plan mode, which refuses edits and allows commands: only its instructions keep those read-only.`);
        return { id: `p${index + 1}`, name, handle: handles[index]!, providerId: r.providerId, model: r.model ?? '', effort: r.effort ?? null, ...(roles[index] ? { role: roles[index]! } : {}), threadId: null, readOnly, absent: [], pending: false, scores: [] };
      });
      const salon = salonOf(ctx, parent, id, request);
      const now = ctx.now();
      const council: Council = {
        id, request, parentThreadId: parent.id, salonThreadId: salon.id, round: 0, roundsDone: 0, status: 'running', members, timeoutMinutes, note: null, delivered: false, roundDeadline: null, warnings,
        createdAt: now, updatedAt: now, finishedAt: null, version: 1
      };
      state(ctx).councils.set(id, council);
      if (requestId !== null) state(ctx).requests.set(`${parent.id}\n${requestId}`, { id, fingerprint });
      beginRound(id, 1);
      return structuredClone(state(ctx).councils.get(id)!);
    },
    'council.again': async (params) => {
      gate();
      const council = require(params?.councilId);
      own(council, params.threadId);
      const given = (value: unknown) => value !== undefined && value !== null && value !== '';
      const changes = given(params.changes) ? text(params.changes, 'changes', COUNCIL_LIMITS.requestChars) : null;
      const request = given(params.request) ? text(params.request, 'request', COUNCIL_LIMITS.requestChars) : null;
      if (params.sendChanges !== undefined && typeof params.sendChanges !== 'boolean') throw invalid('sendChanges: expected true or false', { field: 'sendChanges' });
      if (params.sendChanges === true && changes === null) throw invalid('sendChanges: nothing to send; say what changed', { field: 'changes' });
      const requestId = params.requestId === undefined ? null : text(params.requestId, 'requestId', 100);
      const key = `${council.id}\n${requestId}`;
      const fingerprint = JSON.stringify([changes, request, params.sendChanges === true]);
      if (requestId !== null && state(ctx).rounds.has(key)) {
        if (state(ctx).rounds.get(key) !== fingerprint) throw refused('requestId already used for a different round', { field: 'requestId', expected: 'a fresh id' });
        return structuredClone(council);
      }
      if (councilOver(council)) throw refused(`council ${council.id} is over (${council.status}); start a new one with boite delegate council`, { councilId: council.id, status: council.status });
      if (council.status === 'running') throw refused(`round ${council.round} of council ${council.id} is still running; its answers come back as a message`, { councilId: council.id, status: council.status });
      const parent = ctx.thread(council.parentThreadId);
      if (parent.archived) throw refused('the thread that started it is archived', { threadId: parent.id });
      const config = delegationConfig(ctx, parent.id);
      if (config.enabled && config.paused) throw refused('this conversation\'s subagents are paused; resume them before a new round', { threadId: parent.id });
      if (requestId !== null) state(ctx).rounds.set(key, fingerprint);
      const round = council.round + 1;
      if (request !== null) save(state(ctx).councils.get(council.id)!, draft => { draft.request = request; });
      if (changes !== null) post(council, { round, author: COUNCIL_AUTHOR, text: changes, to: null, inReplyTo: null });
      beginRound(council.id, round);
      return structuredClone(state(ctx).councils.get(council.id)!);
    },
    'council.list': async (params) => {
      gate();
      const threadId = params?.threadId === undefined ? undefined : text(params.threadId, 'threadId', 128);
      return { councils: structuredClone(all().filter(council => threadId === undefined || council.parentThreadId === threadId).slice(0, 30)) };
    },
    'council.get': async (params) => {
      gate();
      const council = require(params?.councilId);
      return { council: structuredClone(council), posts: structuredClone(postsOf(council.id)) };
    },
    'council.table': async (params) => {
      gate();
      const council = require(params?.councilId);
      own(council, params.threadId);
      if (council.legacy) throw refused('a debate from before the council has no scores, so no table', { councilId: council.id });
      return { table: councilTable(council), council: structuredClone(council) };
    },
    'council.post': async (params) => {
      gate();
      const council = require(params?.councilId);
      const body = text(params.text, 'text', COUNCIL_LIMITS.postChars);
      const id = params.id === undefined ? undefined : text(params.id, 'id', 100);
      if (id !== undefined) {
        const mine = postsOf(council.id).find(entry => entry.id === id);
        if (mine) return structuredClone(mine);
        if (all().some(other => postsOf(other.id).some(entry => entry.id === id))) throw refused('id: already used in another council', { field: 'id' });
      }
      if (councilOver(council)) throw refused('the council is over', { councilId: council.id, status: council.status });
      const to = councilMention(body, council.members);
      return post(council, { ...(id === undefined ? {} : { id }), round: council.round + 1, author: COUNCIL_OWNER, text: body, to, inReplyTo: null });
    },
    'council.closeRound': async (params) => {
      gate();
      const council = require(params?.councilId);
      if (council.status !== 'running') throw refused('no round is under way', { councilId: council.id, status: council.status });
      const round = council.round;
      for (const member of council.members.filter(entry => entry.pending)) {
        const current = save(state(ctx).councils.get(council.id)!, draft => {
          const entry = draft.members.find(candidate => candidate.id === member.id)!;
          entry.pending = false;
          if (!entry.absent.includes(round)) entry.absent.push(round);
          entry.scores[round - 1] = null;
        });
        system(current, `${member.name} did not answer round ${round}: closed early.`);
      }
      // Nothing here runs the parent's turn, so the answers count as delivered at once.
      return structuredClone(save(state(ctx).councils.get(council.id)!, draft => {
        draft.status = 'waiting';
        draft.roundsDone = round;
        draft.roundDeadline = null;
        draft.delivered = true;
      }));
    },
    'council.stop': async (params) => {
      gate();
      const council = require(params?.councilId);
      own(council, params.threadId);
      if (councilOver(council)) return structuredClone(council);
      if (council.status === 'waiting') return structuredClone(end(council.id, 'done', null));
      return structuredClone(end(council.id, 'stopped', ctx.bus.principal === 'agent' ? 'Stopped by the agent that started it.' : 'Stopped by the user.'));
    }
  };
}

/**
 * `?fake=1&council=1`: a thread that started two councils, one finished after two
 * rounds, one in its second round with a member still reviewing and an owner's
 * message to one AI, and a debate from before the council. The experiment itself
 * stays the app's to turn on.
 */
export function seedCouncilDemo(ctx: FakeContext): void {
  const at = ctx.now();
  const parent: Thread = {
    id: 't-council', projectId: 'p-boite', title: 'Pick the cache for the sync engine', titleSource: 'prompt', providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null,
    speed: null, cwd: 'C:\\src\\boite', branch: null, permissionMode: 'default', status: 'idle', unread: false, archived: false, pinned: false, sessionId: 'sess-council',
    sessionGeneration: 0, selectionVersion: 0, load: null, context: null, createdAt: at, updatedAt: at + 120_000, messagesBefore: null, commands: [],
    turns: [{ id: 'turn-council-1', threadId: 't-council', status: 'done', queuedAt: at, startedAt: at, finishedAt: at + 90_000, usage: null, error: null }],
    messages: []
  };
  ctx.threads.set(parent.id, parent);
  const names = ['Sonnet 5.5', 'GPT-6 Astra', 'Gemini 4 Pro'];
  const providers = ['claude', 'codex', 'gemini'];
  const cast = (scores: (number | null)[][]): CouncilMember[] => names.map((name, index) => ({
    id: `p${index + 1}`, name, handle: councilHandles(names)[index]!, providerId: providers[index]!, model: name.toLowerCase().replace(/\s+/g, '-'),
    effort: 'xhigh', threadId: null, readOnly: 'native', absent: [], pending: false, scores: scores[index]!
  }));
  const base = { parentThreadId: parent.id, salonThreadId: '', timeoutMinutes: 30, note: null, delivered: true, roundDeadline: null, warnings: [], finishedAt: null, version: 1 };

  const done: Council = {
    ...base, id: 'cnl_demo_done', request: 'Review the plan for the sync engine\'s cache: SQLite next to the journal, rebuilt after a crash.', round: 2, roundsDone: 2, status: 'done',
    members: cast([[7, 9], [6, 9], [null, 8]]), createdAt: at, updatedAt: at + 60_000, finishedAt: at + 60_000
  };
  done.members[2]!.absent = [1];
  const live: Council = {
    ...base, id: 'cnl_demo_live', request: 'Review how the phone follows a council: invalidation events, then a pull.', round: 2, roundsDone: 1, status: 'running', delivered: false,
    members: cast([[8, 8], [7], [6, 9]]), roundDeadline: Date.now() + 7 * 60_000, createdAt: at + 70_000, updatedAt: at + 110_000
  };
  live.members[1]!.pending = true;
  const old: Council = {
    ...base, id: 'dbt_demo_old', request: 'Should the salon keep its own thread?', legacy: true, round: 2, roundsDone: 2, status: 'done',
    members: cast([[], [], []]), createdAt: at - 86_400_000, updatedAt: at - 86_300_000, finishedAt: at - 86_300_000
  };
  for (const council of [done, live, old]) {
    council.salonThreadId = salonOf(ctx, parent, council.id, council.request).id;
    state(ctx).councils.set(council.id, council);
  }
  const posts = (council: Council, rows: [number, string, string, (string | null)?][]) => state(ctx).posts.set(council.id, rows.map(([round, author, body, to], index) => ({
    id: `cpo-demo-${council.id}-${index + 1}`, councilId: council.id, seq: index + 1, round, author, text: body, to: to ?? null, inReplyTo: null, createdAt: council.createdAt + index * 5000
  })));
  posts(done, [
    [1, 'p1', 'One file to back up, and the journal already gives transactions. Nothing caps the size, though, and a phone will feel that first.\n\nScore: 7/10'],
    [1, 'p2', 'A cold start that replays the whole journal is too slow on a phone. Keep the rows, and say how the rebuild is bounded.\n\nScore: 6/10'],
    [1, COUNCIL_SYSTEM, 'Gemini 4 Pro did not answer round 1: no answer within 30 minutes.'],
    [2, COUNCIL_AUTHOR, 'The cache is now capped at 200 MB, oldest rows first, and a rebuild reads the last 1000 entries.'],
    [2, 'p1', 'The cap answers my objection. I checked the eviction order against the journal: it holds.\n\nScore: 9/10'],
    [2, 'p2', 'The bounded rebuild answers mine. One small point left: log how many rows a rebuild dropped.\n\nScore: 9/10'],
    [2, 'p3', 'Reading it fresh: sound. A reset command that empties the cache tables would help when it goes wrong.\n\nScore: 8/10'],
  ]);
  posts(live, [
    [1, 'p1', 'Invalidation, then a pull, keeps one code path. Reading only while the tab is visible saves the battery.\n\nScore: 8/10'],
    [1, 'p2', 'The version in the event tells a client whether anything changed. Say what a client does when it missed one.\n\nScore: 7/10'],
    [1, 'p3', '"Only while visible" misses the card in the thread, which reads too.\n\nScore: 6/10'],
    [2, COUNCIL_AUTHOR, 'The card now reads the list the same way, and a client reads again whenever it reconnects.'],
    [2, COUNCIL_OWNER, '@Gemini what about a phone that was asleep for an hour?', 'p3'],
    [2, 'p3', 'A phone that wakes reconnects, reads once and is current. The card is fixed too.\n\nScore: 9/10'],
    [2, 'p1', 'Still sound. No read while the app is in the background: that part stays my one condition.\n\nScore: 8/10'],
  ]);
  posts(old, [
    [1, 'p1', 'Position: yes\n\nThe salon has its own history and its own unread state.'],
    [1, 'p2', 'Position: no\n\nA panel on the parent is enough.'],
    [1, 'p3', 'Position: yes\n\nA phone needs a page of its own for it.'],
    [2, 'p1', 'Position: yes\n\nVote: its own thread'],
    [2, 'p2', 'Position: yes\n\nVote: its own thread'],
    [2, 'p3', 'Position: yes\n\nVote: its own thread'],
    [2, COUNCIL_LEGACY_SUMMARY, '**Its own thread** won 3 / 3: a history, an unread state and a page on the phone.'],
  ]);
  const message = (id: string, council: Council, lead: string): Message => ({ id, threadId: parent.id, turnId: 'turn-council-1', role: 'assistant', parts: [{ type: 'text', text: lead }, { type: 'council', councilId: council.id, topic: council.request }], state: 'complete', createdAt: council.createdAt });
  parent.messages.push(
    { id: 'm-council-1', threadId: parent.id, turnId: 'turn-council-1', role: 'user', parts: [{ type: 'text', text: 'Have a few AIs review the cache plan, then how the phone follows a council.' }], state: 'complete', createdAt: at },
    message('m-council-2', done, 'Three AIs reviewed the cache plan, twice. Their scores are back:'),
    message('m-council-3', live, 'A second council is reviewing how the phone follows it.'),
    { id: 'm-council-4', threadId: parent.id, turnId: 'turn-council-1', role: 'assistant', parts: [{ type: 'text', text: 'And the debate from before the council:' }, { type: 'debate', debateId: old.id, topic: old.request }], state: 'complete', createdAt: at + 100_000 },
  );
  ctx.touch(parent);
}
