import type { RpcEventName, RpcEvents, ThreadId } from '@boite/contracts';
import type { FakeContext } from './context';

/** What the fake agent predicts next, picked by how many turns the thread finished. */
const NEXT = [
  'Run the tests and show me what fails',
  'Now update the docs to match',
  'Commit this with a short message',
];

/**
 * The core's prediction of the owner's next message (`AgentState.noteSuggestion`):
 * only Claude and Codex make one, only after a turn that finished well in a
 * conversation the owner drives, with no card waiting; a new turn, a sent
 * message, an archive or a removal clears it.
 */
export function observeSuggestion(ctx: FakeContext, event: RpcEventName, payload: unknown): void {
  if (event === 'turn.started') {
    const turn = payload as RpcEvents['turn.started'];
    if (turn.execution?.operation !== 'keepalive') clear(ctx, turn.threadId);
  } else if (event === 'message.started' && (payload as RpcEvents['message.started']).role === 'user') {
    clear(ctx, (payload as RpcEvents['message.started']).threadId);
  } else if (event === 'thread.removed') {
    clear(ctx, (payload as RpcEvents['thread.removed']).threadId);
  } else if (event === 'thread.updated' && (payload as RpcEvents['thread.updated']).archived) {
    clear(ctx, (payload as RpcEvents['thread.updated']).id);
  } else if (event === 'turn.finished') {
    const turn = payload as RpcEvents['turn.finished'];
    if (turn.status !== 'done') return;
    // The agent sends it after its result: the turn's end reaches the client first.
    queueMicrotask(() => suggest(ctx, turn.threadId, turn.id));
  }
}

/** `?suggest=1`: the trace thread rests on a turn the agent already suggested after. */
export function seedSuggestion(ctx: FakeContext): void {
  const thread = ctx.threads.get('t-trace');
  const turnId = thread?.turns.at(-1)?.id;
  if (!thread || !turnId) return;
  thread.suggestion = { turnId, text: 'Wire the table to trace.get and keep it live from the process events', at: Date.now() };
}

function suggest(ctx: FakeContext, threadId: ThreadId, turnId: string): void {
  const thread = ctx.threads.get(threadId);
  if (!thread || thread.archived || thread.status !== 'idle' || thread.turns.at(-1)?.id !== turnId) return;
  if (ctx.settingsInForce().promptSuggestions === false) return;
  if (thread.parentThreadId || thread.agentSessionId || thread.teamId || thread.councilId) return;
  const protocol = ctx.providers.find(provider => provider.id === thread.providerId)?.protocol;
  if (protocol !== 'claude-sdk' && protocol !== 'codex-appserver' && !(ctx.suggestDemo && protocol === 'echo')) return;
  if ([...ctx.pendingQuestions.values()].some(q => q.request.threadId === threadId) || [...ctx.pendingPermissions.values()].some(p => p.request.threadId === threadId)) return;
  const done = thread.turns.filter(turn => turn.status === 'done').length;
  thread.suggestion = { turnId, text: NEXT[(done - 1) % NEXT.length]!, at: Date.now() };
  ctx.emit('thread.suggestion', { threadId, suggestion: structuredClone(thread.suggestion) });
}

function clear(ctx: FakeContext, threadId: ThreadId): void {
  const thread = ctx.threads.get(threadId);
  if (!thread?.suggestion) return;
  thread.suggestion = null;
  ctx.emit('thread.suggestion', { threadId, suggestion: null });
}
