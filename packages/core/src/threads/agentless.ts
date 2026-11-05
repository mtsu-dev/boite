/**
 * A team chat (`docs/teams.md`) and a council's salon (`docs/council.md`) run
 * no agent. Every call that would reach a provider on a thread takes it
 * through here: turns, steering, recovery, titles, compaction, rewind, fork,
 * move, side requests, selection and goals.
 */
import type { ThreadId, ThreadSummary } from '@boite/contracts';
import { refused } from '../errors.ts';

export function requireAgent(threads: { require(threadId: ThreadId): ThreadSummary }, threadId: ThreadId): ThreadSummary {
  const thread = threads.require(threadId);
  if (thread.teamId) throw refused('a team chat runs no agent; post to it through teams.post', { threadId });
  if (thread.councilId) throw refused('a council\'s salon runs no agent; post to it through council.post', { threadId });
  return thread;
}
