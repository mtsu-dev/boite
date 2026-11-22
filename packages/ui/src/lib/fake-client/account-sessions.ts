import type { Account, Thread } from '@boite/contracts';

interface SavedSession {
  sessionId: string;
  providerId: string;
  cwd: string;
  context: Thread['context'];
  after: string;
}

const saved = new WeakMap<Thread, Map<string, SavedSession>>();

export function resumedAccountSession(thread: Thread, accountId: string, sessionId: string | null): SavedSession | undefined {
  const session = saved.get(thread)?.get(accountId);
  return session?.sessionId === sessionId ? session : undefined;
}

export function savedAccountSession(thread: Thread, account: Account): SavedSession | undefined {
  const session = saved.get(thread)?.get(account.id);
  if (!session || session.providerId !== account.providerId || session.cwd !== thread.cwd) return undefined;
  const after = thread.turns.findIndex(turn => turn.id === session.after);
  if (after < 0) return undefined;
  // The fixture has no native transcript. Its generated excerpts are plain text.
  const tail = new Set(thread.turns.slice(after + 1).map(turn => turn.id));
  let chars = 0;
  for (const message of thread.messages) if (tail.has(message.turnId)) {
    for (const part of message.parts) if (part.type === 'text') chars += part.text.length;
    if (chars > 62_400) return undefined;
  }
  return session;
}

export function rememberAccountSession(thread: Thread): void {
  let sessions = saved.get(thread);
  const after = thread.turns.findLast(turn => turn.status === 'done' && turn.execution?.accountId === thread.accountId && turn.execution.sessionGeneration === (thread.sessionGeneration ?? 0));
  if (!thread.sessionId) { sessions?.delete(thread.accountId); return; }
  if (!after) return;
  if (!sessions) { sessions = new Map(); saved.set(thread, sessions); }
  sessions.set(thread.accountId, { sessionId: thread.sessionId, providerId: thread.providerId, cwd: thread.cwd, context: thread.context, after: after.id });
}
