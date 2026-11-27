import type { AccountId, ModelInfo, ProviderId, ThreadId } from '@boite/contracts';
import { ModelProbes } from './model-probes.ts';
import { compactionSetting } from './pi/compaction.ts';
import { agentEnv, piAgentDirFollowsCwd, sessionKey } from './pi/mapping.ts';
import { readModels } from './pi/models.ts';
import { sideQuestion, title } from './pi/one-shot.ts';
import { forkSession } from './pi/session-files.ts';
import { PiSession } from './pi/session.ts';
import { PiTurn } from './pi/turn.ts';
import type { Driver, ProbeContext, ProbeFilter, ProbeResult, SessionContext, TurnContext, TurnHandle } from './types.ts';
import { noteWarmSession } from './driver-log.ts';
import { ThreadSessions } from './thread-sessions.ts';

const MINUTE_MS = 60_000;

/** One `pi --mode rpc` process per thread, kept between turns like the Codex one. */
export function createPiDriver(): Driver {
  const sessions = new ThreadSessions<PiSession>();
  /** Each thread's last ended session's `gone`, until it settles. */
  const exits = new Map<string, Promise<void>>();
  const probes = new ModelProbes(readModels);
  // The core's catalog, the one image admission reads, names a launch's pair only where pi reads the same configuration
  // folder: a relative one is another one in each folder pi starts in, so there the model goes as its text and pi resolves it.
  const catalog = (ctx: { accountEnv: Record<string, string>; catalog?: readonly ModelInfo[] | null }) =>
    piAgentDirFollowsCwd(agentEnv(ctx.accountEnv)) ? null : ctx.catalog ?? null;

  function acquire(ctx: SessionContext): PiSession {
    const threadId = ctx.thread.id;
    const warmMs = Math.max(0, ctx.warmProcessMinutes) * MINUTE_MS;
    const key = sessionKey(ctx);
    const compaction = compactionSetting(ctx);

    let session = sessions.current.get(threadId) ?? null;
    const usable = session?.usable(key, warmMs, compaction) === true;
    noteWarmSession(ctx, 'pi', { kept: session !== null, usable, sameSetup: session?.key === key, setupChange: 'the thread changed model, effort, account or folder' });
    if (session !== null && !usable) {
      sessions.current.delete(threadId);
      session.close(session.key !== key ? 'the thread changed model, effort, account or folder'
        : session.compaction !== compaction ? 'the background compaction setting changed' : null, ctx);
      session = null;
    }
    if (session === null) {
      // A session that just went may leave a pi still exiting on the same session file: the next one waits for it.
      session = new PiSession(key, warmMs, (ended) => {
        sessions.ended(threadId, ended);
        exits.set(threadId, ended.gone);
        void ended.gone.then(() => { if (exits.get(threadId) === ended.gone) exits.delete(threadId); });
      }, compaction, catalog, exits.get(threadId));
      sessions.current.set(threadId, session);
    }
    const running = session;
    if (sessions.viewed.has(threadId)) running.setViewed(true);
    return running;
  }

  return {
    title: ctx => title(ctx, catalog(ctx)),
    sideQuestion: ctx => sideQuestion(ctx, catalog(ctx)),
    forkSession,
    prepare: (ctx, options) => acquire(ctx).prepare(ctx, options?.forTurn),
    setViewed: sessions.setViewed,
    protocol: 'pi',

    probe(ctx: ProbeContext): Promise<ProbeResult> {
      return probes.probe(ctx);
    },

    probedModels(providerId: ProviderId, accountId: AccountId): ModelInfo[] | null {
      return probes.models(providerId, accountId);
    },

    forgetProbes(filter: ProbeFilter = {}): void {
      probes.forget(filter);
    },

    startTurn(ctx: TurnContext): TurnHandle {
      const turn = new PiTurn(ctx);
      const warmMs = Math.max(0, ctx.warmProcessMinutes) * MINUTE_MS;
      const running = acquire(ctx);
      running.attach(turn, warmMs);
      return {
        done: turn.done,
        steer: (message, attachments, onAccepted, signal) => running.steer(turn, message, attachments, onAccepted, signal),
        applySettings: change => running.applySettings(turn, change),
        stop: (): void => {
          running.stopTurn(turn);
        },
      };
    },

    releaseThread(threadId: ThreadId): void {
      sessions.viewed.delete(threadId);
      sessions.takeIdle(threadId)?.close(null);
    },

    shutdown(): void {
      const open = sessions.takeAll();
      for (const session of open) session.close(null);
      probes.forget();
    },
  };
}
