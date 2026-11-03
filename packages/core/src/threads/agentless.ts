/**
 * A team chat (`docs/teams.md`) and a debate's salon (`docs/debates.md`) run
 * no agent. Every call that would reach a provider on a thread takes it
 * through here: turns, steering, recovery, titles, compaction, rewind, fork,
 * move, side requests, selection and goals.
 */
import type { ThreadId, ThreadSummary } from '@boite/contracts';
import { refused } from '../errors.ts';

export function requireAgent(threads: { require(threadId: ThreadId): ThreadSummary }, threadId: ThreadId): ThreadSummary {
  const thread = threads.require(threadId);
  if (thread.teamId) throw refused('a team chat runs no agent; post to it through teams.post', { threadId });
  if (thread.debateId) throw refused('a debate\'s salon runs no agent; post to it through debates.post', { threadId });
  return thread;
}
