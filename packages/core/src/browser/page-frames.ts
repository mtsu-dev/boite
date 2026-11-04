/*
 * How one tab reaches the documents of frames from other origins, which the
 * page kit cannot read from its parent. A frame of the same site runs in the
 * page's renderer, in an execution context of its own on the tab's session; a
 * frame of another site runs in a process of its own, a target that a command
 * attaches to and leaves when it ends. The kit's state lives in each frame's
 * window, so its refs outlast the session that read them. In the core's own
 * browser the tab's session never runs the runtime (`page-runtime.ts`), so it
 * hears of no context: the kit runs in an isolated world of the frame
 * instead, the same one each time it is asked for, which the page's scripts
 * never see.
 */
import type { Cdp } from './cdp.ts';
import type { FrameChannel, PageFrames } from './automation.ts';
import { followPage, pageRuntime } from './page-runtime.ts';

type Subscribe = (method: string, listener: (params: Record<string, unknown>) => void) => void;

/** The isolated world the kit runs in on a frame whose page cannot know of it. */
const KIT_WORLD = 'boite-kit';

/**
 * `on` subscribes to an event of the tab's own session, for as long as the tab
 * lives. `topFrame` is the tab's target id, whose documents the runtime
 * follows; null for the desktop app's webviews, which keep it on everywhere
 * since the shell reads their console itself.
 */
export function pageFrames(cdp: Cdp, sessionId: string, on: Subscribe, topFrame: string | null): PageFrames {
  const runtime = pageRuntime(cdp, sessionId, topFrame);
  if (topFrame !== null) followPage(runtime, cdp, sessionId, topFrame, on);
  const hosted = topFrame === null;
  /** Each session's frames, by id, with the context their own document runs in, on the desktop app's webviews. */
  const contexts = new Map<string, Map<string, number>>();
  const watch = (session: string, subscribe: Subscribe) => {
    const frames = new Map<string, number>();
    contexts.set(session, frames);
    subscribe('Runtime.executionContextCreated', params => {
      const context = params.context as { id: number; auxData?: { frameId?: string; isDefault?: boolean } };
      if (context.auxData?.isDefault && context.auxData.frameId) frames.set(context.auxData.frameId, context.id);
    });
    // The desktop app does not relay this one: a context it left behind fails its next evaluation, and the frame reads as gone.
    subscribe('Runtime.executionContextDestroyed', params => { for (const [frame, id] of frames) if (id === params.executionContextId) frames.delete(frame); });
    subscribe('Runtime.executionContextsCleared', () => frames.clear());
  };
  if (hosted) watch(sessionId, on);
  const opened = new Map<string, Array<() => void>>();
  const channel = (session: string, contextId?: number): FrameChannel => ({
    session, ...(contextId === undefined ? {} : { contextId }),
    send: (method, params = {}, timeoutMs) => cdp.send(method, params, session, timeoutMs),
  });
  return {
    runtime,
    async reach(parent, frameId) {
      const session = parent.session ?? sessionId;
      const known = contexts.get(session)?.get(frameId);
      if (known !== undefined) return channel(session, known);
      // A frame of another site is a target whose id is the frame's.
      const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: frameId, flatten: true }).catch(() => null);
      if (attached) {
        const child = attached.sessionId, offs: Array<() => void> = [];
        opened.set(child, offs);
        // On the desktop app, its own frames of the same site are contexts on its session, listed as soon as the runtime is enabled.
        if (hosted) {
          watch(child, (method, listener) => offs.push(cdp.on(method, (params, from) => { if (from === child) listener(params); })));
          await cdp.send('Runtime.enable', {}, child).catch(() => {});
        }
        return channel(child);
      }
      if (hosted) return null;
      const world = await cdp.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId, worldName: KIT_WORLD }, session).catch(() => null);
      return world ? channel(session, world.executionContextId) : null;
    },
    release() {
      for (const [session, offs] of opened) {
        for (const off of offs) off();
        contexts.delete(session);
        void cdp.send('Target.detachFromTarget', { sessionId: session }).catch(() => {});
      }
      opened.clear();
    },
  };
}
