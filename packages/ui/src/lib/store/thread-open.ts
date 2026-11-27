import { RpcErrorCode, unreadInterruptionAt, type Thread, type ThreadId, type ThreadSnapshot } from '@boite/contracts';
import type { Client } from '../client';
import { RpcFailure } from '../rpc-error';
import type { StoreContext } from './context';
import type { Preload } from './thread-preload';

export interface PreviewOrigin {
  threadId: ThreadId;
  generation: number;
  previous: Thread | null;
  page: StoreContext['store']['page'];
  draft: StoreContext['store']['draft'];
}

/** A superseded open hands its subscription back unless the newer visit uses it. */
export async function retireThreadOpen(ctx: StoreContext, client: Client, threadId: ThreadId, newest: () => boolean): Promise<void> {
  const { threads, delegation } = ctx;
  if (client === ctx.client && threads.openTarget === null && threads.subscribedThreadId && threads.subscribedThreadId !== threadId) {
    await client.call('threads.subscribe', { threadId: threads.subscribedThreadId, ...ctx.streams.params(threads.subscribedThreadId) }).catch(() => undefined);
  }
  if (client !== ctx.client || (threads.subscribedThreadId !== threadId && delegation.delegationSubscribedThreadId !== threadId && threads.preloads.waitingThreadId !== threadId && (threads.openTarget !== threadId || newest()))) {
    await client.call('threads.unsubscribe', { threadId }).catch(() => undefined);
  }
}

/** The device can fill the summary unless a page or an authoritative refusal arrived first. */
export function paintWhileFetching(local: Promise<Thread | undefined> | undefined, network: Promise<unknown>, newest: () => boolean, paint: (page: Thread) => void, onMiss?: () => void): void {
  if (!local) return;
  let answered = false;
  let settled = false;
  void network.then(() => { answered = true; settled = true; }, error => {
    settled = true;
    answered = error instanceof RpcFailure && (error.code === RpcErrorCode.NotFound || error.code === RpcErrorCode.Refused);
  });
  void local.then(page => {
    if (answered || !newest()) return;
    if (page) paint(page);
    else if (!settled) onMiss?.();
  }, () => { if (!settled && newest()) onMiss?.(); });
}

/** Open claims the press's reads so events received during the press still win over its snapshot. */
export function openThreadRequests(ctx: StoreContext, client: Client, threadId: ThreadId, fetched: Promise<ThreadSnapshot>, press: Preload | null, bundled: boolean, requested: boolean) {
  const { requests } = ctx;
  if (!requested) {
    press?.permissionRead?.cancel();
    press?.questionRead?.cancel();
  }
  const permission = requested ? press?.permissionRead ?? requests.permissionRead(client, threadId,
    bundled ? () => fetched.then(thread => thread.opened?.permissions ?? []) : undefined) : undefined;
  const question = requested ? press?.questionRead ?? requests.questionRead(client, threadId,
    bundled ? () => fetched.then(thread => thread.opened?.questions ?? []) : undefined) : undefined;
  const secret = requested ? requests.secretRead(client, threadId, () => fetched.then(thread => requests.secretParts(thread))) : undefined;
  const cards = Promise.all([permission?.promise ?? [], question?.promise ?? []]);
  void fetched.catch(() => undefined);
  void cards.catch(() => undefined);
  void secret?.promise.catch(() => undefined);
  return {
    async apply(newest: () => boolean, unsubscribed: Promise<unknown>): Promise<void> {
      const [permissions, questions] = await cards;
      if (!newest()) return;
      permission?.apply(permissions);
      question?.apply(questions);
      const secrets = await secret?.promise;
      await unsubscribed;
      if (newest() && secrets) secret?.apply(secrets);
    },
    cancel() {
      permission?.cancel();
      question?.cancel();
      secret?.cancel();
    }
  };
}

/** Mark only interruptions and unread status that still belong to the current visit. */
export async function markThreadOpened(client: Client, thread: Thread, newest: () => boolean, marked: () => void): Promise<void> {
  const interruptionAt = thread.interruptionReadAt === undefined ? undefined : unreadInterruptionAt(thread);
  if (interruptionAt !== undefined) await client.call('threads.markRead', { threadId: thread.id, interruptionAt });
  if (!newest() || !thread.unread) return;
  await client.call('threads.markRead', { threadId: thread.id });
  if (!newest()) return;
  thread.unread = false;
  marked();
}

/** The workbench trace belongs to the thread on screen. */
export function showThreadTrace(ctx: StoreContext, threadId: ThreadId, refresh: boolean): void {
  const { store, workbench } = ctx;
  if (workbench.tracedThreadId !== threadId) store.trace = [];
  else if (refresh && store.traceWatched) void store.refreshTrace();
  workbench.tracedThreadId = threadId;
}
