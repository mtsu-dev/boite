import type { ThreadId } from '@boite/contracts';
import { RpcErrorCode } from '@boite/contracts';
import { RpcFailure } from '../client';
import type { StoreContext } from './context';

/**
 * Activity's "Mark all as read": each thread leaves the feed at once, then the
 * core records it, so every client of this machine drops the same rows. A
 * thread the core no longer knows is skipped; one it refused comes back unread
 * and the refusal shows.
 */
export async function markRead(ctx: StoreContext, threadIds: readonly ThreadId[]): Promise<void> {
  const client = ctx.client;
  const clientGeneration = ctx.clientGeneration;
  const rows = ctx.threads;
  const ids = new Set(threadIds.filter(id => rows.threads.some(t => t.id === id && t.unread)));
  if (!client || ids.size === 0) return;
  rows.threads = rows.threads.map((t) => (ids.has(t.id) ? { ...t, unread: false } : t));
  const order = [...ids];
  const results = await Promise.allSettled(order.map(threadId => client.call('threads.markRead', { threadId })));
  if (!ctx.currentClient(client, clientGeneration)) return;
  const failed = order.filter((_, index) => {
    const result = results[index]!;
    return result.status === 'rejected' && !(result.reason instanceof RpcFailure && result.reason.code === RpcErrorCode.NotFound);
  });
  if (failed.length === 0) return;
  // What the core refused stays unread, as it is there.
  rows.threads = rows.threads.map((t) => (failed.includes(t.id) ? { ...t, unread: true } : t));
  ctx.fail((results[order.indexOf(failed[0]!)] as PromiseRejectedResult).reason);
}
