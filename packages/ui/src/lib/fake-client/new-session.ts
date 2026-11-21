/**
 * `agents.session.new`, as the core's `agents/new-session.ts` answers it: the
 * same refusals, the new conversation at the turn's end when one runs, the
 * same marker in the thread. The fake has no provider session to drop beyond
 * the thread's own fields, and no context block to carry the note.
 */
import { AGENT_HANDOFF_MAX, RpcErrorCode, threadActive, type Message, type NewConversationNotice, type RpcParams, type RpcResult, type Thread } from '@boite/contracts';
import type { FakeContext } from './context';
import { RpcFailure } from '../client';
import { refusal } from './shared';

/** As the core's `MOCHI_NEW_SESSION_GAP_MS` and `NEW_CONVERSATION_TEXT`. */
const MOCHI_GAP_MS = 30 * 60_000;
const MARKER_TEXT = 'New conversation: the next turn starts a fresh session without the messages above. Memory, routines and desk are kept.';

interface State { waiting: Map<string, NewConversationNotice>; last: Map<string, { by: NewConversationNotice['by']; at: number }> }
const states = new WeakMap<FakeContext, State>();
function state(ctx: FakeContext): State {
  let found = states.get(ctx);
  if (!found) states.set(ctx, found = { waiting: new Map(), last: new Map() });
  return found;
}

function apply(ctx: FakeContext, thread: Thread, notice: NewConversationNotice): void {
  const message: Message = {
    id: `m-${++ctx.seq}`, threadId: thread.id, turnId: thread.turns.at(-1)?.id ?? `turn-${++ctx.seq}`, role: 'system',
    parts: [{ type: 'text', text: MARKER_TEXT, newConversation: notice }], state: 'complete', createdAt: ctx.now(),
  };
  thread.messages.push(message);
  ctx.emitToThread(thread.id, 'message.started', structuredClone(message));
  ctx.emitToThread(thread.id, 'message.completed', { threadId: thread.id, messageId: message.id, state: 'complete' });
  thread.sessionId = null;
  thread.sessionResumeAt = null;
  thread.sessionGeneration = (thread.sessionGeneration ?? 0) + 1;
  thread.context = null;
  thread.promptCache = null;
  state(ctx).last.set(thread.id, { by: notice.by, at: ctx.now() });
  ctx.touch(thread);
}

/** The new conversation asked during the turn, as the core's turn runner calls `newSessions.applyWaiting`. */
export function applyWaitingNewSession(ctx: FakeContext, threadId: string): void {
  const waiting = state(ctx).waiting;
  const notice = waiting.get(threadId);
  if (notice === undefined) return;
  waiting.delete(threadId);
  const thread = ctx.threads.get(threadId);
  if (thread) apply(ctx, thread, notice);
}

/** `agents.session.new`, answered through `agentSettingMethods`, the fake's agent methods that reach its threads. */
export function newSession(ctx: FakeContext, params: RpcParams<'agents.session.new'>): RpcResult<'agents.session.new'> {
  // An agent calls with its own thread; the owner names the mochi.
  const agentId = params.threadId !== undefined ? ctx.agents.ownerOf(params.threadId) : params.agentId ?? null;
  if (!agentId) throw refusal('agents.session.new: expected a mochi, or the thread of one', { field: 'agentId', expected: 'the thread of a mochi' });
  const threadId = params.threadId ?? ctx.agents.conversationOf(agentId);
  const thread = threadId === null ? undefined : ctx.threads.get(threadId);
  if (!thread) throw refusal('agents.session.new: this mochi has no conversation yet; open it first', { field: 'agentId', expected: 'a mochi with a thread' });
  const note = params.note?.trim() || null;
  if (note !== null && note.length > AGENT_HANDOFF_MAX) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `note: expected 0 to ${AGENT_HANDOFF_MAX} characters`, data: { field: 'note', expected: `1 to ${AGENT_HANDOFF_MAX} characters` } });
  const by: NewConversationNotice['by'] = params.threadId !== undefined ? 'mochi' : 'user';
  const last = state(ctx).last.get(thread.id);
  if (by === 'mochi' && last?.by === 'mochi' && ctx.now() - last.at < MOCHI_GAP_MS) {
    throw refusal(`agents.session.new: a mochi may start another conversation ${MOCHI_GAP_MS / 60_000} minutes after the last`, { threadId: thread.id, reason: 'too-soon' });
  }
  const notice: NewConversationNotice = { by, ...(note ? { note } : {}) };
  if (threadActive(thread.status) || ctx.inFlight.has(thread.id)) {
    state(ctx).waiting.set(thread.id, notice);
    return { agentId, threadId: thread.id, when: 'turn-end' };
  }
  apply(ctx, thread, notice);
  return { agentId, threadId: thread.id, when: 'done' };
}
