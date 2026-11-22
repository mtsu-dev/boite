import type { ThreadId } from '@boite/contracts';

interface ViewedSession {
  busy(): boolean;
  setViewed(viewed: boolean): void;
}

/** Tracks live sessions and views, which can arrive before a session opens. */
export class ThreadSessions<Session extends ViewedSession> {
  readonly current = new Map<ThreadId, Session>();
  readonly viewed = new Set<ThreadId>();

  readonly setViewed = (threadId: ThreadId, active: boolean): void => {
    if (active) this.viewed.add(threadId);
    else this.viewed.delete(threadId);
    this.current.get(threadId)?.setViewed(active);
  };

  ended(threadId: ThreadId, session: Session): void {
    if (this.current.get(threadId) === session) this.current.delete(threadId);
  }

  takeIdle(threadId: ThreadId): Session | undefined {
    const session = this.current.get(threadId);
    if (session === undefined || session.busy()) return undefined;
    this.current.delete(threadId);
    return session;
  }

  takeAll(): Session[] {
    const open = [...this.current.values()];
    this.current.clear();
    this.viewed.clear();
    return open;
  }
}
