import type { ThreadId } from '@boite/contracts';
import type { TabsJoining } from './joining.ts';
import type { Engine, Tab } from './types.ts';

/** How long a command waits for Chrome's inventory before using the windows it knows. */
const TARGETS_LIST_MS = 2000;

export interface PopupTarget {
  targetId: string;
  type: string;
  openerId?: string;
  url: string;
}

interface PopupTabs {
  tabAt(engine: Engine, targetId: string): Tab | undefined;
  full(threadId: ThreadId): boolean;
  attach(engine: Engine, threadId: ThreadId, targetId: string, url: string): Promise<Tab>;
}

export class BrowserPopups {
  /** Windows already taken by the event or the inventory, until Chrome reports them gone. */
  #adopted = new WeakMap<Engine, Set<string>>();
  /** Targets destroyed during each outstanding inventory, including events in the same CDP read as its reply. */
  #inventories = new WeakMap<Engine, Set<Set<string>>>();

  constructor(private joining: TabsJoining, private tabs: PopupTabs) {}

  /** A window joins its opener's conversation as a new tab, or is closed when it has no room. */
  async adopt(engine: Engine, info: PopupTarget): Promise<void> {
    if (info.type !== 'page' || !info.openerId) return;
    const opener = this.tabs.tabAt(engine, info.openerId);
    if (!opener) return;
    const adopted = this.#adopted.get(engine) ?? new Set<string>();
    this.#adopted.set(engine, adopted);
    if (adopted.has(info.targetId) || this.tabs.tabAt(engine, info.targetId)) return;
    adopted.add(info.targetId);
    const { threadId } = opener;
    const shut = () => engine.cdp.send('Target.closeTarget', { targetId: info.targetId }).then(() => {}, () => {});
    // Reserve in the event's own turn so a burst of windows sees each other.
    if (this.tabs.full(threadId)) return shut();
    const release = this.joining.reserve(threadId);
    return this.joining.window(threadId, async () => {
      // Attachment can fail if the conversation was archived while it ran.
      const tab = await this.tabs.attach(engine, threadId, info.targetId, info.url).catch(() => null).finally(release);
      if (!tab) await shut();
    });
  }

  destroyed(engine: Engine, targetId: string): void {
    for (const destroyed of this.#inventories.get(engine) ?? []) destroyed.add(targetId);
    this.#adopted.get(engine)?.delete(targetId);
  }

  /**
   * Adopt existing windows whose creation event has yet to arrive. A window a
   * sandbox refused holds nothing. Hosted webviews use the event alone.
   */
  async adoptListed(threadId: ThreadId, engines: ReadonlySet<Engine>): Promise<void> {
    await Promise.all([...engines].map(async engine => {
      const active = this.#inventories.get(engine) ?? new Set<Set<string>>();
      this.#inventories.set(engine, active);
      const destroyed = new Set<string>();
      active.add(destroyed);
      try {
        const listed = await engine.cdp.send<{ targetInfos?: PopupTarget[] }>('Target.getTargets', {}, undefined, TARGETS_LIST_MS).catch(() => null);
        for (const info of listed?.targetInfos ?? []) {
          if (!info.openerId || destroyed.has(info.targetId)) continue;
          if (this.tabs.tabAt(engine, info.openerId)?.threadId === threadId) void this.adopt(engine, info);
        }
      } finally {
        active.delete(destroyed);
        if (!active.size) this.#inventories.delete(engine);
      }
    }));
  }
}
