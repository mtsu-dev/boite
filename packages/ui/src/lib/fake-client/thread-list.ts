import { gradeMessage, listCursorProblem, messageSearchTerms, orderMessageMatches, RpcErrorCode, searchableMessageText, THREAD_LIST_PAGE_BYTES, ThreadListPages, type ThreadMessageMatch } from '@boite/contracts';
import { RpcFailure } from '../client';
import type { FakeContext, FakeMethods } from './context';
import { toSummary } from './shared';

export function threadListMethods(ctx: FakeContext): Pick<FakeMethods, 'threads.list' | 'threads.listChanges' | 'threads.search'> {
  const pages = new ThreadListPages();
  return {
    'threads.search': async ({ query, limit = 20, includeArchived = true }) => {
      const terms = messageSearchTerms(query);
      const matches: ThreadMessageMatch[] = [];
      if (!terms.length) return { query, matches };
      for (const thread of ctx.threads.values()) {
        if (thread.incognito || (!includeArchived && thread.archived) || (thread.projectId && ctx.removedProjects.has(thread.projectId))) continue;
        let best: ThreadMessageMatch | undefined;
        for (const message of thread.messages) {
          if (message.role !== 'user' && message.role !== 'assistant') continue;
          const grade = gradeMessage(searchableMessageText(message), terms);
          if (!grade) continue;
          const hit = { threadId: thread.id, messageId: message.id, messageCreatedAt: message.createdAt, role: message.role, ...grade };
          if (!best || orderMessageMatches(hit, best) < 0) best = hit;
        }
        if (best) matches.push(best);
      }
      return { query, matches: matches.sort(orderMessageMatches).slice(0, limit) };
    },
    'threads.list': async (params) => {
      return [...ctx.threads.values()]
        .filter((t) => (params.projectId ? t.projectId === params.projectId : true))
        .filter((t) => (params.includeArchived ? true : !t.archived))
        .map((t) => structuredClone(toSummary(t)));
    },
    // The core's answer (`threads/list-changes.ts`): whole, or the rows changed since plus every row with a load.
    'threads.listChanges': async (params) => {
      const { since, page } = params ?? {};
      const problem = since === undefined ? null : listCursorProblem(since);
      if (problem) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: `threads.listChanges.${problem.field}: expected ${problem.expected}`, data: problem });
      const cursor = ctx.threadChanges.cursor();
      const read = (id: string) => {
        const thread = ctx.threads.get(id);
        return thread ? toSummary(thread) : null;
      };
      const take = (page: string) => {
        const answer = pages.take(page, read);
        if (!answer) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'threads.listChanges.page: expected the next cursor of this connection' });
        return structuredClone(answer);
      };
      if (typeof page === 'string') return take(page);
      if (page !== undefined && page !== true) throw new RpcFailure({ code: RpcErrorCode.InvalidParams, message: 'threads.listChanges.page: expected true or a continuation cursor' });
      const changed = since === undefined ? null : ctx.threadChanges.since(since);
      const listed = [...ctx.threads.values()].filter(t => !t.archived);
      const start = () => take(pages.start(cursor, listed.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1)).map(t => t.id), crypto.randomUUID()));
      if (changed === null) return page ? start() : { kind: 'full', cursor, threads: listed.map(t => structuredClone(toSummary(t))) };
      const asked = new Set(changed);
      const threads = listed.filter(t => asked.has(t.id) || t.load != null).map(t => structuredClone(toSummary(t)));
      const answered = new Set(threads.map(t => t.id));
      const answer = { kind: 'changes' as const, cursor, threads, removed: changed.filter(id => !answered.has(id)) };
      return page && new TextEncoder().encode(JSON.stringify(answer)).length > THREAD_LIST_PAGE_BYTES ? start() : answer;
    },
  };
}
