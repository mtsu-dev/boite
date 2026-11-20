import type { ThreadId } from '@boite/contracts';
import { ModelProbes } from './model-probes.ts';
import { sessionKey } from './muse/mapping.ts';
import { readModels } from './muse/models.ts';
import { MuseSession } from './muse/session.ts';
import { MuseTurn } from './muse/turn.ts';
import type { Driver, SessionContext, TurnContext, TurnHandle } from './types.ts';
import { noteWarmSession } from './driver-log.ts';
import { ThreadSessions } from './thread-sessions.ts';
export { choiceFor, museExecutable, museHostArgs } from './muse/mapping.ts';
export { modelsFrom, readCatalogEfforts } from './muse/models.ts';
export { mintUuidV7, MspError } from './muse/rpc.ts';

const MINUTE_MS = 60_000;

/** One `muse serve` host per thread, kept between turns like the Codex one. */
export function createMuseDriver(): Driver {
  const sessions = new ThreadSessions<MuseSession>();
  const probes = new ModelProbes(readModels);

  function acquire(ctx: SessionContext): MuseSession {
    const threadId = ctx.thread.id;
    const warmMs = Math.max(0, ctx.warmProcessMinutes) * MINUTE_MS;
    const key = sessionKey(ctx);

    let session = sessions.current.get(threadId) ?? null;
    const usable = session?.usable(key, warmMs) === true;
    noteWarmSession(ctx, 'Muse', { kept: session !== null, usable, sameSetup: session?.key === key, setupChange: 'the thread changed mode, account or folder' });
    if (session !== null && !usable) {
      sessions.current.delete(threadId);
      session.close(session.key === key ? null : 'the thread changed mode, account or folder', ctx);
      session = null;
    }
    if (session === null) {
      session = new MuseSession(key, warmMs, ended => sessions.ended(threadId, ended));
      sessions.current.set(threadId, session);
    }
    const running = session;
    if (sessions.viewed.has(threadId)) running.setViewed(true);
    return running;
  }

  return {
    prepare: (ctx, options) => acquire(ctx).prepare(ctx, options?.forTurn),
    setViewed: sessions.setViewed,
    protocol: 'muse',

    probe: (context) => probes.probe(context),
    probedModels: (providerId, accountId) => probes.models(providerId, accountId),
    forgetProbes: (filter) => probes.forget(filter),

    startTurn(ctx: TurnContext): TurnHandle {
      const turn = new MuseTurn(ctx);
      const warmMs = Math.max(0, ctx.warmProcessMinutes) * MINUTE_MS;
      const running = acquire(ctx);
      running.attach(turn, warmMs);
      return {
        done: turn.done,
        stop: (): void => {
          running.stopTurn(turn);
        },
        steer: (text, _attachments, onAccepted, signal) => running.steer(turn, text, onAccepted, signal),
      };
    },

    releaseThread(threadId: ThreadId): void {
      sessions.viewed.delete(threadId);
      sessions.takeIdle(threadId)?.close(null);
    },

    shutdown(): void {
      const open = sessions.takeAll();
      probes.forget();
      for (const session of open) session.close(null);
    },
  };
}
