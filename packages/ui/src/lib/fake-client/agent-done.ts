/** `agent.done`, as the core's `threads/agent-done.ts` answers it: the same refusals, Done at the turn's end, the same system lines. */
import { threadActive, type AgentDone, type Message, type Thread, type ThreadId } from '@boite/contracts';
import { RpcFailure } from '../client';
import { assertIdleFamily } from './completion';
import type { FakeContext, FakeMethods } from './context';
import { refusal } from './shared';

function busy(ctx: FakeContext, thread: Thread): boolean {
  return threadActive(thread.status) || ctx.inFlight.has(thread.id);
}

/** A line of the timeline from the core, on the thread's last turn. */
function line(ctx: FakeContext, thread: Thread, text: string): void {
  const message: Message = { id: `m-${++ctx.seq}`, threadId: thread.id, turnId: thread.turns.at(-1)?.id ?? `turn-${++ctx.seq}`, role: 'system', parts: [{ type: 'text', text }], state: 'complete', createdAt: ctx.now() };
  thread.messages.push(message);
  ctx.emitToThread(thread.id, 'message.started', structuredClone(message));
  ctx.emitToThread(thread.id, 'message.completed', { threadId: thread.id, messageId: message.id, state: 'complete' });
}

/** As the user's Mark done: an idle family only, and the thread lands in the Done list. */
function apply(ctx: FakeContext, thread: Thread): Promise<unknown> {
  // Nobody watches this one land: unsent input on a device keeps the thread open.
  if (ctx.hasProtectedInput(thread.id)) throw refusal('the user has unsent input open on a device', { threadId: thread.id, field: 'threadId', expected: 'a thread without unsent input' });
  assertIdleFamily(ctx, thread.id, true);
  // `threads.archive` sets the Done state before its first await, so the line follows it as in the core.
  const archived = ctx.markDone(thread.id);
  line(ctx, thread, 'Put in Done by its agent.');
  return archived;
}

/**
 * The Done the agent asked for during the turn, now that the turn ended. A user
 * message queued meanwhile, or background work left running, keeps the thread
 * open with a line saying why.
 */
export function applyWaitingDone(ctx: FakeContext, threadId: ThreadId): void {
  if (!ctx.waitingDone.delete(threadId)) return;
  const thread = ctx.threads.get(threadId);
  if (!thread || thread.archived) return;
  try {
    void apply(ctx, thread).catch(() => {});
  } catch (error) {
    const reason = error instanceof RpcFailure ? error.message : String(error);
    line(ctx, thread, `The agent asked to put this thread in Done; it stays open: ${reason}`);
  }
}

export function agentDoneMethods(ctx: FakeContext) {
  return {
    'agent.done': async (params): Promise<AgentDone> => {
      const { threadId } = params;
      const thread = ctx.thread(threadId);
      if (thread.parentThreadId) throw refusal('a sub-thread is put away with its parent once its work is delivered', { threadId, field: 'threadId', expected: 'a top-level thread' });
      if (thread.agentSessionId) throw refusal('a bot\'s thread stays open', { threadId, field: 'threadId', expected: 'a conversation thread' });
      if (thread.archived) throw refusal('this thread is already archived', { threadId, field: 'threadId', expected: 'a thread that is not archived' });
      if (busy(ctx, thread)) {
        ctx.waitingDone.add(threadId);
        return { threadId, when: 'turn-end' };
      }
      await apply(ctx, thread);
      return { threadId, when: 'done' };
    },
  } satisfies Partial<FakeMethods>;
}
