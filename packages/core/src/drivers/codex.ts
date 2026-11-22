import type { ThreadId } from '@boite/contracts';
import { sessionKey } from './codex/mapping.ts';
import { forkSession } from './codex/fork.ts';
import { readModels } from './codex/models.ts';
import { CodexSession } from './codex/session.ts';
import { titleTurn } from './codex/title.ts';
import { CodexTurn } from './codex/turn.ts';
import { ModelProbes } from './model-probes.ts';
import type { Driver, SessionContext, TurnContext, TurnHandle } from './types.ts';
import { noteWarmSession } from './driver-log.ts';
import { ThreadSessions } from './thread-sessions.ts';
export { readCodexQuota } from './codex/models.ts';

const MINUTE_MS = 60_000;

/** One `codex app-server` process per thread, kept between turns like the ACP one. */
export function createCodexDriver(): Driver {
  const sessions = new ThreadSessions<CodexSession>();
  const probes = new ModelProbes(async context => {
    const session = context.catalogThread ? sessions.current.get(context.catalogThread.id) : undefined;
    if (session) {
      try {
        const models = await session.catalog(context);
        if (models) return models;
      } catch { /* A host that exited or refused discovery leaves the ordinary probe available. */ }
    }
    return readModels(context);
  });

  function acquire(ctx: SessionContext): CodexSession {
    const threadId = ctx.thread.id;
    const warmMs = Math.max(0, ctx.warmProcessMinutes) * MINUTE_MS;
    const key = sessionKey(ctx);
    let session = sessions.current.get(threadId) ?? null;
    let previousClosed = Promise.resolve();
    const usable = session?.usable(key, warmMs) === true;
    const setupChange = 'the thread changed mode, account, folder or compaction limit';
    noteWarmSession(ctx, 'Codex app-server', { kept: session !== null, usable, sameSetup: session?.key === key, setupChange });
    if (session !== null && !usable) {
      previousClosed = session.close(session.key === key ? null : setupChange, ctx);
      session = null;
    }
    if (session === null) {
      session = new CodexSession(key, warmMs, ended => sessions.ended(threadId, ended), previousClosed);
      if (sessions.viewed.has(threadId)) session.setViewed(true);
      sessions.current.set(threadId, session);
    }
    return session;
  }

  return {
    protocol: 'codex-appserver',
    forkSession,

    probe: (context) => probes.probe(context),
    probedModels: (providerId, accountId) => probes.models(providerId, accountId),
    forgetProbes: (filter) => probes.forget(filter),
    title: (context) => titleTurn(context),

    prepare: (ctx, options) => acquire(ctx).prepare(ctx, options?.forTurn),
    setViewed: sessions.setViewed,

    startTurn(ctx: TurnContext): TurnHandle {
      const warmMs = Math.max(0, ctx.warmProcessMinutes) * MINUTE_MS;
      const turn = new CodexTurn(ctx);
      const running = acquire(ctx);
      running.attach(turn, warmMs);
      return {
        done: turn.done,
        steer: (text, attachments, onAccepted, signal) => running.steer(turn, text, attachments, onAccepted, signal),
        applySettings: change => running.applySettings(turn, change),
        stop: (): void => {
          running.stopTurn(turn);
        },
      };
    },

    releaseThread(threadId: ThreadId): void {
      const session = sessions.current.get(threadId);
      if (session === undefined || session.busy()) return;
      session.release();
    },

    shutdown(): void {
      const open = [...sessions.current.values()];
      sessions.viewed.clear();
      probes.forget();
      for (const session of open) void session.close(null);
    },
  };
}
