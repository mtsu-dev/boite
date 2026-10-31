/**
 * A bot moved to another machine of the group (`agents.move`, `bot.move`).
 * The source sends the whole bot in one sealed request: its profile without
 * what only that machine knows (account, session, thread, record ids), its
 * brain files, routines, settings, waiting facts and the end of its
 * conversation as text excerpts (`messageExcerpt`). The target creates it,
 * a new thread seeded with those excerpts, and the move note its next prompt
 * carries. Only once the target answers that it holds the bot does the source
 * archive the old thread with a line, then drop the profile, its routines,
 * its settings and its brain folder (renamed beside it). Until then the
 * source keeps the bot as it was: a target that refuses, or does not answer,
 * changes nothing here, and the same `requestId` sent again gets the same
 * answer from both ends.
 */
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_BUILTINS, AGENT_DAILY_BUDGET, AGENT_ROUTINE_NAME_MAX, AGENT_ROUTINE_PROMPT_MAX, AGENT_ROUTINES_MAX,
  type AgentBuiltin, type AgentMoveResult, type AgentProfile, type AgentRoutine, type AgentRuntimeConfig, type AgentSchedule, type AgentSelection, type AgentSession,
  type CoordinationPeer, type Message, type MoveNotice, type RpcParams, type ThreadSummary, type Turn,
} from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, refused, RpcFailure } from '../errors.ts';
import { newId } from '../ids.ts';
import { messageExcerpt } from '../continuation.ts';
import { PeerGone, PeerRefusal } from '../coordination-wire.ts';
import { machineArg, memberNamed } from '../threads/group-spawn.ts';
import { checkEffort, checkModel } from '../threads/selection.ts';
import { MOVE_NOTE_PREFIX, withLoad } from '../threads/records.ts';
import { readBrainFile, rewriteBrainFile } from './brain-files.ts';
import { defaultAccount, BUILTIN_TEXT } from './builtin.ts';
import { MEMORY_ARCHIVE } from './context.ts';
import { remoteGrant } from './group-bots.ts';
import { checkSchedule, nextOccurrence } from './routines.ts';
import { rootThread } from './spend.ts';
import type { AgentStore } from './store.ts';
import { boolean, ids, integer, object, oneOf, text } from './validation.ts';

/** The brain files a move carries, in this order. `skills/` stays behind. */
export const MOVED_BRAIN_FILES = ['AGENTS.md', 'MEMORY.md', MEMORY_ARCHIVE] as const;
/** What the brain files may weigh together, in UTF-8 bytes. */
export const MOVE_BRAIN_MAX = 96_000;
/** The conversation excerpts a move carries, in characters, newest first; each message is cut by `messageExcerpt`. */
export const MOVE_HISTORY_MAX = 48_000;
/** At most this many messages of the conversation. */
export const MOVE_MESSAGES_MAX = 200;
/** Facts still waiting for the bot. */
export const MOVE_FACTS_MAX = 100;
/**
 * The whole payload as JSON, in bytes: the sealed body is base64 and must stay
 * under `MAX_BODY` (262 144), which leaves room for the envelope.
 */
export const MOVE_PAYLOAD_MAX = 180_000;
/** The answer that the target read no `bot.move`: its Boite is older than this feature. */
const OLD_CORE = 'operation: expected';
const MOVED_OUT = 'agents:moved-out:';
const MOVED_IN = 'agents:moved-in:';
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'yolo', 'dontAsk'] as const;

/** What `AgentStore` lends this file: making a thread and forgetting one stay its own. */
export interface MoveHooks {
  createThread(agent: AgentProfile, lost: AgentSession | null): AgentSession;
  forgetThread(threadId: string): void;
}

/** One carried message: its excerpt, its role, the turn it belonged to (counted within the move) and when it was written. */
interface MovedMessage { role: Message['role']; text: string; turn: number; at: number }
interface MovedRoutine { name: string; prompt: string; schedule: AgentSchedule; enabled: boolean; spent: boolean }
interface MovedSettings { autoMemory: boolean; eventWakes: boolean; dailyBudgetUsd: number | null; subagents: { enabled: boolean; paused: boolean; anyModel: boolean } }

/** The `bot.move` payload. */
export interface BotMovePayload {
  v: 1;
  requestId: string;
  from: { coreId: string; name: string };
  profile: {
    id: string; name: string; domain: string; instructions: string; avatar: string; status: 'active' | 'paused';
    builtin?: AgentBuiltin; projectIds: string[]; selection: Omit<AgentSelection, 'accountId'>;
  };
  settings: MovedSettings | null;
  brain: Partial<Record<(typeof MOVED_BRAIN_FILES)[number], string>>;
  routines: MovedRoutine[];
  history: { messages: MovedMessage[]; omitted: number };
  facts: { key: string; text: string }[];
}

type Receipt = Omit<AgentMoveResult, 'machine'>;

export class BotMoves {
  readonly #core: Core;
  readonly #store: AgentStore;
  readonly #hooks: MoveHooks;
  /** Bots this machine is sending now: a second move of the same bot waits for none and is refused. */
  readonly #moving = new Set<string>();
  constructor(core: Core, store: AgentStore, hooks: MoveHooks) {
    this.#core = core;
    this.#store = store;
    this.#hooks = hooks;
  }

  // -- the machine it leaves --------------------------------------------------

  /** `agents.move`: the owner sends a bot to another machine of the group. */
  async move(params: RpcParams<'agents.move'>): Promise<AgentMoveResult> {
    object(params, 'params');
    const requestId = params.requestId === undefined ? newId('mov_') : text(params.requestId, 'requestId', 160);
    const done = this.#core.journal.getSetting(`${MOVED_OUT}${requestId}`) as AgentMoveResult | undefined;
    if (done !== undefined) return done;
    const agent = this.#store.records.get('profile', text(params.agentId, 'agentId', 160));
    const peer = memberNamed(this.#core, text(params.machine, 'machine', 200), 'agents.move');
    if (agent.status === 'archived') throw refused(`agents.move: ${agent.name} is archived; restore it before moving it`, { field: 'agentId', expected: 'an active or paused bot' });
    if (this.#moving.has(agent.id)) throw refused(`agents.move: ${agent.name} is already moving to another machine`, { field: 'agentId', reason: 'moving' });
    const session = this.#store.sessionOf(agent.id);
    const thread = session === null ? null : this.#core.journal.getThread(session.threadId);
    if (thread !== null) this.#idle(agent, thread);
    const payload = this.#payload(agent, thread, peer, requestId);
    this.#moving.add(agent.id);
    let answer: unknown;
    try {
      answer = await this.#core.coordination.request(peer, 'bot.move', payload);
    } catch (error) {
      throw this.#failure(peer, error);
    } finally { this.#moving.delete(agent.id); }
    const receipt = answer as Partial<Receipt> | null;
    if (receipt?.agentId !== agent.id || typeof receipt.threadId !== 'string' || !Array.isArray(receipt.projectIds) || !Array.isArray(receipt.groupProjects)) {
      throw refused(`agents.move: ${peer.name} gave an answer this machine does not read; update Boite on both machines, then move the bot again with the same requestId`, { field: 'machine', requestId });
    }
    const result: AgentMoveResult = { agentId: agent.id, machine: peer.coreId, threadId: receipt.threadId, projectIds: receipt.projectIds as string[], groupProjects: receipt.groupProjects as string[] };
    this.#leave(this.#store.records.get('profile', agent.id), thread, peer);
    this.#core.journal.setSetting(`${MOVED_OUT}${requestId}`, result);
    return result;
  }

  /** A move waits for the bot's thread and every thread below it to be idle, as `threads.move` does. */
  #idle(agent: AgentProfile, thread: ThreadSummary): void {
    const children = this.#core.journal.listChildThreads().filter(child => rootThread(this.#core, child.id) === thread.id);
    const busy = [thread, ...children].find(one => this.#core.threads.isBusy(one.id));
    if (busy === undefined) return;
    throw refused(busy.id === thread.id
      ? `agents.move: ${agent.name} has a turn running or queued; stop it or let it end before moving the bot`
      : `agents.move: ${agent.name}'s sub-thread ${busy.id} has a turn running or queued; stop it before moving the bot`, {
      field: 'agentId', threadId: thread.id, busyThreadId: busy.id, reason: 'turn-in-flight', status: busy.status, expected: 'an idle bot',
    });
  }

  #payload(agent: AgentProfile, thread: ThreadSummary | null, peer: CoordinationPeer, requestId: string): BotMovePayload {
    const self = this.#core.group.selfId();
    const name = this.#core.group.view('owner')?.cores.find(entry => entry.coreId === self)?.name ?? self;
    const projectIds = (agent.projectIds ?? []).map(id => {
      const grant = remoteGrant(id);
      if (grant === null) return `${self}/${id}`;
      return grant.coreId === peer.coreId ? grant.projectId : id;
    });
    const saved = this.#core.journal.getSetting(`agents:runtime:${agent.id}`) as AgentRuntimeConfig | undefined;
    const settings: MovedSettings | null = saved === undefined ? null : {
      autoMemory: saved.autoMemory !== false, eventWakes: saved.eventWakes === true, dailyBudgetUsd: saved.dailyBudgetUsd ?? null,
      subagents: { enabled: saved.subagents.enabled, paused: saved.subagents.paused, anyModel: saved.subagents.anyModel !== false },
    };
    const brain: BotMovePayload['brain'] = {};
    const root = this.#store.resident.brainRoot().path;
    const folder = this.#store.resident.brain(agent.id).path;
    let weight = 0;
    for (const file of MOVED_BRAIN_FILES) {
      const path = join(folder, file);
      if (!existsSync(path)) continue;
      const content = readBrainFile(root, path);
      weight += Buffer.byteLength(content);
      if (weight > MOVE_BRAIN_MAX) {
        throw refused(`agents.move: brain.${file}: ${agent.name}'s brain files come to more than the ${MOVE_BRAIN_MAX} bytes a move carries; shorten ${path} first`, { field: `brain.${file}`, path, max: MOVE_BRAIN_MAX });
      }
      brain[file] = content;
    }
    const routines = this.#store.records.list('routine').filter(routine => routine.agentId === agent.id).map(routine => ({
      name: routine.name, prompt: routine.prompt, schedule: routine.schedule, enabled: routine.enabled,
      spent: routine.schedule.kind === 'once' && routine.lastScheduledAt !== null,
    }));
    const payload: BotMovePayload = {
      v: 1, requestId, from: { coreId: self, name },
      profile: {
        id: agent.id, name: agent.name, domain: agent.domain, instructions: agent.instructions, avatar: agent.avatar, status: agent.status === 'paused' ? 'paused' : 'active',
        ...(agent.builtin === undefined ? {} : { builtin: agent.builtin }), projectIds,
        selection: { providerId: agent.selection.providerId, model: agent.selection.model, effort: agent.selection.effort, permissionMode: agent.selection.permissionMode },
      },
      settings, brain, routines,
      history: thread === null ? { messages: [], omitted: 0 } : this.#history(thread.id),
      facts: this.#core.agentRuntime.facts(agent.id).slice(-MOVE_FACTS_MAX).map(fact => ({ key: fact.key, text: fact.text })),
    };
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (bytes > MOVE_PAYLOAD_MAX) {
      throw refused(`agents.move: ${agent.name} comes to ${bytes} bytes, more than the ${MOVE_PAYLOAD_MAX} a move carries; shorten its instructions or its brain files first`, { field: 'agentId', bytes, max: MOVE_PAYLOAD_MAX });
    }
    return payload;
  }

  /** The newest messages within `MOVE_HISTORY_MAX` characters, oldest first, and how many older ones stay behind. */
  #history(threadId: string): BotMovePayload['history'] {
    const messages: MovedMessage[] = [];
    const turns = new Map<string, number>();
    let size = 0, omitted = 0;
    for (const message of this.#core.journal.walkMessages(threadId, { newestFirst: true })) {
      const excerpt = messageExcerpt(message);
      if (!excerpt) continue;
      if (omitted > 0 || messages.length >= MOVE_MESSAGES_MAX || size + excerpt.length > MOVE_HISTORY_MAX) { omitted += 1; continue; }
      if (!turns.has(message.turnId)) turns.set(message.turnId, turns.size);
      messages.push({ role: message.role, text: excerpt, turn: turns.get(message.turnId)!, at: message.createdAt });
      size += excerpt.length;
    }
    // Turns were counted newest first: oldest first, they count up.
    const last = turns.size - 1;
    return { messages: messages.reverse().map(message => ({ ...message, turn: last - message.turn })), omitted };
  }

  /** What a refusal or a silence of the target becomes for the owner. Nothing changed here. */
  #failure(peer: CoordinationPeer, error: unknown): RpcFailure {
    const machine = machineArg(this.#core, peer);
    if (error instanceof RpcFailure) return error;
    if (error instanceof PeerRefusal) {
      if (error.message.startsWith(OLD_CORE)) return refused(`agents.move: update Boite on ${peer.name}; it cannot take a bot from another machine yet`, { field: 'machine', machine, expected: 'features.botMove' });
      return refused(error.message, { field: 'machine', machine });
    }
    if (error instanceof PeerGone) return refused(`agents.move: ${peer.name} removed this machine from its group`, { field: 'machine', machine });
    return refused(`agents.move: ${peer.name} did not answer (${error instanceof Error ? error.message : String(error)}); the bot stays here, and the same requestId tries again without moving it twice`, { field: 'machine', machine, reason: 'unreachable' });
  }

  /** The target holds the bot: this machine keeps its thread, archived with a line, and nothing else of it. */
  #leave(agent: AgentProfile, thread: ThreadSummary | null, peer: CoordinationPeer): void {
    if (thread !== null) {
      this.#core.agentRuntime.line(agent.id, `Moved to ${peer.name}`);
      if (!thread.archived) this.#core.threads.archive(thread.id, true);
    }
    const path = this.#store.resident.brainPath(agent.id);
    this.#store.records.transaction(() => {
      for (const routine of this.#store.records.list('routine').filter(r => r.agentId === agent.id)) this.#store.records.remove('routine', routine.id);
      for (const session of this.#store.records.list('session').filter(s => s.agentId === agent.id)) this.#store.records.remove('session', session.id);
      this.#store.records.remove('profile', agent.id);
    });
    this.#core.agentRuntime.forget(agent.id);
    // Its settings: every key that ends with the bot's or its thread's id.
    const ends = [`:${agent.id}`, ...(thread === null ? [] : [`:${thread.id}`])];
    const keys = this.#core.journal.db.query("SELECT key FROM settings WHERE key LIKE 'agents:%' OR key LIKE 'group-bots:%' OR key LIKE 'resident-follow:%'").all() as { key: string }[];
    for (const { key } of keys) if (ends.some(end => key.endsWith(end)) && !key.startsWith(MOVED_OUT)) this.#core.journal.deleteSetting(key);
    // The brain stays on disk under another name: nothing the bot wrote is deleted.
    if (existsSync(path)) {
      try { renameSync(path, `${path}-moved-${new Date().toISOString().replace(/[:.]/g, '-')}`); }
      catch (error) { this.#core.log('warn', `agent ${agent.id}: its brain folder ${path} stays as it is after the move: ${String(error)}`); }
    }
    if (thread !== null) this.#hooks.forgetThread(thread.id);
    this.#store.group.profileChanged(agent, { ...agent, projectIds: [] });
    this.#store.changed();
  }

  // -- the machine it arrives on ------------------------------------------------

  /**
   * `bot.move` from a member: the bot is created here, or the answer it got
   * the first time for that request. Synchronous, so the same request reaching
   * several addresses at once is handled once.
   */
  receive(peer: CoordinationPeer, raw: unknown): Receipt {
    const payload = readPayload(raw);
    if (payload.from.coreId !== peer.coreId) throw refused('bot.move.from.coreId: a machine moves only its own bots', { field: 'from.coreId', expected: peer.coreId });
    const key = `${MOVED_IN}${peer.coreId}:${payload.requestId}`;
    const done = this.#core.journal.getSetting(key) as Receipt | undefined;
    if (done !== undefined) return done;
    const self = this.#core.group.selfId();
    const here = this.#core.group.view('owner')?.cores.find(entry => entry.coreId === self)?.name ?? self;
    const moved = payload.profile;
    if (this.#store.records.find('profile', moved.id) !== null) {
      throw refused(`agents.move: ${here} already holds a bot ${moved.id}; it came by another move or was never removed there`, { field: 'agentId' });
    }
    if (moved.builtin !== undefined && this.#store.builtins.live(moved.builtin) !== null) {
      throw refused(`agents.move: ${here} already has its own ${moved.builtin} bot; reset or pause one of them, a machine runs one of each built-in bot`, { field: 'agentId', builtin: moved.builtin });
    }
    const selection = this.#route(moved.selection, moved.name, here);
    // A project of this machine is local again; one it does not have, or drafts, stays behind.
    const projectIds = moved.projectIds.flatMap(id => {
      const grant = remoteGrant(id);
      if (grant?.coreId === self) return [];
      if (grant !== null) return [id];
      const project = this.#core.projects.list().find(entry => entry.id === id);
      return project !== undefined && project.kind !== 'drafts' ? [id] : [];
    });
    const groupProjects = projectIds.filter(id => remoteGrant(id)?.coreId === peer.coreId);
    const shipped = moved.builtin === undefined ? undefined : BUILTIN_TEXT[moved.builtin];
    const value: Omit<AgentProfile, 'id' | 'revision' | 'createdAt' | 'updatedAt'> = {
      name: moved.name, domain: shipped?.domain ?? moved.domain, instructions: shipped?.instructions ?? moved.instructions, avatar: moved.avatar,
      status: moved.status, projectIds, selection, ...(moved.builtin === undefined ? {} : { builtin: moved.builtin }),
    };
    // Carried facts wait for its next turn: filed before its settings, they wake nothing on arrival.
    const profile = this.#store.records.adopt('profile', moved.id, value);
    for (const fact of payload.facts) this.#core.agentRuntime.fact(profile.id, { key: fact.key, text: fact.text, urgent: false, replace: true, threadIds: [] });
    if (payload.settings !== null) {
      const config: AgentRuntimeConfig = {
        defaultRoute: selection, allowedRoutes: [{ ...selection, model: selection.model!, id: 'default', name: 'Default' }],
        subagents: { ...payload.settings.subagents, profiles: [] },
        autoMemory: payload.settings.autoMemory, eventWakes: payload.settings.eventWakes, dailyBudgetUsd: payload.settings.dailyBudgetUsd,
      };
      this.#core.journal.setSetting(`agents:runtime:${profile.id}`, config);
    }
    const session = this.#hooks.createThread(profile, null);
    const brain = this.#store.resident.brain(profile.id);
    const root = this.#store.resident.brainRoot().path;
    for (const file of MOVED_BRAIN_FILES) if (payload.brain[file] !== undefined) rewriteBrainFile(root, join(brain.path, file), payload.brain[file]!);
    const now = Date.now();
    for (const routine of payload.routines) {
      const enabled = routine.enabled && !routine.spent;
      this.#store.records.create('routine', {
        agentId: profile.id, name: routine.name, prompt: routine.prompt, schedule: routine.schedule, enabled,
        nextAt: !enabled ? null : routine.schedule.kind === 'once' ? routine.schedule.at : nextOccurrence(routine.schedule, now),
        lastTurnId: null, lastScheduledAt: routine.spent ? (routine.schedule as { at: number }).at : null, lastOutcome: null,
      });
    }
    const thread = this.#seed(session.threadId, payload.history);
    const notice: MoveNotice = {
      from: { projectId: payload.from.coreId, name: peer.name, cwd: `${peer.name}:${thread.cwd}` },
      to: { projectId: self, name: here, cwd: thread.cwd },
      note: `You moved from ${peer.name} to ${here} on ${new Date(now).toISOString()}. Your memory, notes, routines and the end of your conversation came with you; the projects of ${peer.name} are reached as ${machineArg(this.#core, peer)}/<project> through the group.\n\n`,
      at: now,
    };
    this.#core.journal.setSetting(`${MOVE_NOTE_PREFIX}${thread.id}`, notice);
    this.#store.group.profileChanged(null, profile);
    const receipt: Receipt = { agentId: profile.id, threadId: thread.id, projectIds, groupProjects };
    this.#core.journal.setSetting(key, receipt);
    this.#store.changed();
    return receipt;
  }

  /**
   * The same provider on this machine's signed-in account for it, with the
   * model and level it ran when this machine lists them; else this machine's
   * default route. Refused before anything is written when nothing can run it.
   */
  #route(wanted: BotMovePayload['profile']['selection'], name: string, here: string): AgentSelection {
    const same = defaultAccount(this.#core, wanted.providerId);
    const account = same ?? defaultAccount(this.#core);
    if (account === undefined) throw refused(`agents.move: ${here} has no signed-in account to run ${name}; sign in there first`, { field: 'machine', expected: 'a signed-in account' });
    const descriptor = this.#core.providers.require(account.providerId);
    const fallback = descriptor.models.find(model => model.default)?.id ?? descriptor.models[0]?.id ?? null;
    let model = fallback, effort: string | null = null;
    if (same !== undefined && wanted.model !== null) {
      try { model = checkModel(descriptor, account.id, wanted.model) ?? fallback; } catch { model = fallback; }
      if (model === wanted.model) { try { effort = checkEffort(descriptor, account.id, model, wanted.effort); } catch { effort = null; } }
    }
    if (model === null) throw refused(`agents.move: ${here} has no model to run ${name} on ${descriptor.name}; sign in there first`, { field: 'machine' });
    return { providerId: account.providerId, accountId: account.id, model, effort, permissionMode: wanted.permissionMode };
  }

  /** The carried excerpts as finished turns of the new thread, which its first turn sends to a fresh session (`continuationInput`). */
  #seed(threadId: string, history: BotMovePayload['history']): ThreadSummary {
    const thread = this.#core.threads.require(threadId);
    const turns = new Map<number, Turn>();
    const messages: Message[] = [];
    for (const moved of history.messages) {
      let turn = turns.get(moved.turn);
      if (turn === undefined) {
        turn = { id: newId('trn_'), threadId, status: 'done', queuedAt: moved.at, startedAt: moved.at, finishedAt: moved.at, usage: null, error: null };
        turns.set(moved.turn, turn);
      }
      turn.finishedAt = Math.max(turn.finishedAt ?? moved.at, moved.at);
      messages.push({ id: newId('msg_'), threadId, turnId: turn.id, role: moved.role, parts: [{ type: 'text', text: moved.text }], state: 'complete', createdAt: moved.at });
    }
    if (history.omitted > 0 && messages.length > 0) {
      messages.unshift({ id: newId('msg_'), threadId, turnId: messages[0]!.turnId, role: 'system', parts: [{ type: 'text', text: `${history.omitted} older messages stayed on the machine this bot came from.` }], state: 'complete', createdAt: messages[0]!.createdAt });
    }
    // Generation 1 with no session: the first turn carries this history to a fresh session, as a fork does.
    const next: ThreadSummary = { ...thread, sessionId: null, sessionGeneration: 1, updatedAt: Date.now() };
    this.#core.journal.append({ type: 'thread.moved.in', threadId, version: 1, payload: { turns: turns.size, messages: messages.length } }, () => {
      for (const turn of turns.values()) this.#core.journal.putTurn(turn);
      for (const message of messages) this.#core.journal.putMessage(message);
      this.#core.journal.putThread(next);
    });
    const summary = withLoad(this.#core, this.#core.threads.require(threadId));
    this.#core.bus.emit('thread.updated', summary);
    return summary;
  }
}

/** The payload as a sender must write it; any other shape is refused with its field. */
function readPayload(raw: unknown): BotMovePayload {
  object(raw, 'bot.move');
  if (raw.v !== 1) throw invalidParams('bot.move.v: expected 1');
  const requestId = text(raw.requestId, 'bot.move.requestId', 160);
  object(raw.from, 'bot.move.from');
  const from = { coreId: text(raw.from.coreId, 'bot.move.from.coreId', 200), name: text(raw.from.name, 'bot.move.from.name', 200) };
  const p = raw.profile;
  object(p, 'bot.move.profile');
  object(p.selection, 'bot.move.profile.selection');
  const s = p.selection;
  const profile: BotMovePayload['profile'] = {
    id: text(p.id, 'bot.move.profile.id', 160), name: text(p.name, 'bot.move.profile.name', 100), domain: text(p.domain, 'bot.move.profile.domain', 500, true),
    instructions: text(p.instructions, 'bot.move.profile.instructions', 32000, true), avatar: text(p.avatar, 'bot.move.profile.avatar', 40, true),
    status: oneOf(p.status, 'bot.move.profile.status', ['active', 'paused']),
    ...(p.builtin === undefined ? {} : { builtin: oneOf(p.builtin, 'bot.move.profile.builtin', AGENT_BUILTINS) }),
    projectIds: ids(p.projectIds, 'bot.move.profile.projectIds', 50),
    selection: {
      providerId: text(s.providerId, 'bot.move.profile.selection.providerId', 100),
      model: s.model === null ? null : text(s.model, 'bot.move.profile.selection.model', 200),
      effort: s.effort === null ? null : text(s.effort, 'bot.move.profile.selection.effort', 100),
      permissionMode: oneOf(s.permissionMode, 'bot.move.profile.selection.permissionMode', PERMISSION_MODES),
    },
  };
  let settings: MovedSettings | null = null;
  if (raw.settings !== null) {
    object(raw.settings, 'bot.move.settings');
    const v = raw.settings;
    object(v.subagents, 'bot.move.settings.subagents');
    const budget = v.dailyBudgetUsd;
    if (budget !== null && (typeof budget !== 'number' || !Number.isFinite(budget) || budget < AGENT_DAILY_BUDGET.min || budget > AGENT_DAILY_BUDGET.max)) {
      throw invalidParams(`bot.move.settings.dailyBudgetUsd: expected dollars a day from ${AGENT_DAILY_BUDGET.min} to ${AGENT_DAILY_BUDGET.max}, or null`);
    }
    settings = {
      autoMemory: boolean(v.autoMemory, 'bot.move.settings.autoMemory'), eventWakes: boolean(v.eventWakes, 'bot.move.settings.eventWakes'), dailyBudgetUsd: budget as number | null,
      subagents: { enabled: boolean(v.subagents.enabled, 'bot.move.settings.subagents.enabled'), paused: boolean(v.subagents.paused, 'bot.move.settings.subagents.paused'), anyModel: boolean(v.subagents.anyModel, 'bot.move.settings.subagents.anyModel') },
    };
  }
  object(raw.brain, 'bot.move.brain');
  const brain: BotMovePayload['brain'] = {};
  let weight = 0;
  for (const [file, content] of Object.entries(raw.brain)) {
    if (!(MOVED_BRAIN_FILES as readonly string[]).includes(file)) throw invalidParams(`bot.move.brain.${file}: expected ${MOVED_BRAIN_FILES.join(', ')}`);
    if (typeof content !== 'string') throw invalidParams(`bot.move.brain.${file}: expected text`);
    weight += Buffer.byteLength(content);
    if (weight > MOVE_BRAIN_MAX) throw invalidParams(`bot.move.brain.${file}: the brain files come to more than ${MOVE_BRAIN_MAX} bytes`);
    brain[file as (typeof MOVED_BRAIN_FILES)[number]] = content;
  }
  if (!Array.isArray(raw.routines) || raw.routines.length > AGENT_ROUTINES_MAX) throw invalidParams(`bot.move.routines: expected at most ${AGENT_ROUTINES_MAX} routines`);
  const routines = raw.routines.map((entry: unknown, index: number): MovedRoutine => {
    const field = `bot.move.routines[${index}]`;
    object(entry, field);
    object(entry.schedule, `${field}.schedule`);
    return {
      name: text(entry.name, `${field}.name`, AGENT_ROUTINE_NAME_MAX), prompt: text(entry.prompt, `${field}.prompt`, AGENT_ROUTINE_PROMPT_MAX),
      schedule: checkSchedule(entry.schedule as unknown as AgentSchedule), enabled: boolean(entry.enabled, `${field}.enabled`), spent: boolean(entry.spent, `${field}.spent`),
    };
  });
  object(raw.history, 'bot.move.history');
  const h = raw.history;
  if (!Array.isArray(h.messages) || h.messages.length > MOVE_MESSAGES_MAX) throw invalidParams(`bot.move.history.messages: expected at most ${MOVE_MESSAGES_MAX} messages`);
  let size = 0;
  const messages = h.messages.map((entry: unknown, index: number): MovedMessage => {
    const field = `bot.move.history.messages[${index}]`;
    object(entry, field);
    const message = {
      role: oneOf(entry.role, `${field}.role`, ['user', 'assistant', 'system'] as const), text: text(entry.text, `${field}.text`, MOVE_HISTORY_MAX),
      turn: integer(entry.turn, `${field}.turn`, 0, MOVE_MESSAGES_MAX), at: integer(entry.at, `${field}.at`, 0, Number.MAX_SAFE_INTEGER),
    };
    size += message.text.length;
    if (size > MOVE_HISTORY_MAX) throw invalidParams(`bot.move.history.messages: expected at most ${MOVE_HISTORY_MAX} characters in all`);
    return message;
  });
  const omitted = integer(h.omitted, 'bot.move.history.omitted', 0, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(raw.facts) || raw.facts.length > MOVE_FACTS_MAX) throw invalidParams(`bot.move.facts: expected at most ${MOVE_FACTS_MAX} facts`);
  const facts = raw.facts.map((entry: unknown, index: number) => {
    object(entry, `bot.move.facts[${index}]`);
    return { key: text(entry.key, `bot.move.facts[${index}].key`, 400), text: text(entry.text, `bot.move.facts[${index}].text`, 16000) };
  });
  return { v: 1, requestId, from, profile, settings, brain, routines, history: { messages, omitted }, facts };
}
