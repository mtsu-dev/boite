import type { RpcParams } from '@boite/contracts';
import { RpcErrorCode } from '@boite/contracts';
import { RpcFailure } from '../client';
import type { StoreContext } from './context';

/**
 * Activity's "Mark all as read": each thread leaves the feed at once, then the
 * core records it, so every client of this machine drops the same rows. A
 * thread the core no longer knows is skipped; one it refused comes back unread
 * and the refusal shows.
 */
export async function markRead(ctx: StoreContext, requests: readonly RpcParams<'threads.markRead'>[]): Promise<void> {
  const client = ctx.client;
  const clientGeneration = ctx.clientGeneration;
  const rows = ctx.threads;
  if (!client || requests.length === 0) return;
  const ids = new Set(requests.filter(request => request.interruptionAt === undefined).map(request => request.threadId));
  const unread = rows.threads.filter(thread => ids.has(thread.id) && thread.unread).map(thread => thread.id);
  rows.threads = rows.threads.map((t) => (ids.has(t.id) && t.unread ? { ...t, unread: false } : t));
  const results = await Promise.allSettled(requests.map(request => client.call('threads.markRead', request)));
  if (!ctx.currentClient(client, clientGeneration)) return;
  const failed = results.flatMap((result, index) => result.status === 'rejected' && !(result.reason instanceof RpcFailure && result.reason.code === RpcErrorCode.NotFound)
    ? [{ reason: result.reason, request: requests[index]! }] : []);
  if (failed.length === 0) return;
  // What the core refused stays unread, as it is there.
  const restore = new Set(failed.filter(({ request }) => request.interruptionAt === undefined && unread.includes(request.threadId)).map(({ request }) => request.threadId));
  rows.threads = rows.threads.map((t) => (restore.has(t.id) ? { ...t, unread: true } : t));
  ctx.fail(failed[0]!.reason);
}
