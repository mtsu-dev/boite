/*
 * How one tab reaches the documents of frames from other origins, which the
 * page kit cannot read from its parent. A frame of another site runs in a
 * process of its own, a target that a command attaches to and leaves when it
 * ends. Any other frame is reached on the tab's session, in an isolated world
 * of the frame, the same one each time it is asked for, which the page's
 * scripts never see: the tab's runtime is off on public pages
 * (`page-runtime.ts`), so the frames' own contexts are not reported. The kit's
 * state lives in each frame's window, so its refs outlast the session that
 * read them. The desktop app's webviews attach to no target: there each frame
 * is reached on the tab's session.
 */
import type { Cdp } from './cdp.ts';
import type { FrameChannel, PageFrames } from './automation.ts';
import { followHostedPage, followPage, pageRuntime } from './page-runtime.ts';

type Subscribe = (method: string, listener: (params: Record<string, unknown>) => void) => void;

/** The isolated world the kit runs in on a frame whose page cannot know of it. */
const KIT_WORLD = 'boite-kit';

/**
 * `on` subscribes to an event of the tab's own session, for as long as the tab
 * lives. `topFrame` is the tab's target id, whose documents the runtime
 * follows; null for the desktop app's webviews, whose top frame it learns.
 */
export function pageFrames(cdp: Cdp, sessionId: string, on: Subscribe, topFrame: string | null): PageFrames {
  const runtime = pageRuntime(cdp, sessionId, topFrame);
  if (topFrame !== null) followPage(runtime, cdp, sessionId, topFrame, on);
  else followHostedPage(runtime, cdp, sessionId, on);
  const opened = new Set<string>();
  const channel = (session: string, contextId?: number): FrameChannel => ({
    session, ...(contextId === undefined ? {} : { contextId }),
    send: (method, params = {}, timeoutMs) => cdp.send(method, params, session, timeoutMs),
  });
  return {
    runtime,
    async reach(parent, frameId) {
      const session = parent.session ?? sessionId;
      // A frame of another site is a target whose id is the frame's.
      const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: frameId, flatten: true }).catch(() => null);
      if (attached) {
        opened.add(attached.sessionId);
        return channel(attached.sessionId);
      }
      const world = await cdp.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId, worldName: KIT_WORLD }, session).catch(() => null);
      return world ? channel(session, world.executionContextId) : null;
    },
    release() {
      for (const session of opened) void cdp.send('Target.detachFromTarget', { sessionId: session }).catch(() => {});
      opened.clear();
    },
  };
}
