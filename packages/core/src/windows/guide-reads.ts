/*
 * The reads a conversation keeps for the guide: the numbered one `point <id>`
 * takes ids from, and the last read of each window, which a read with
 * `changes` numbers the next one against (docs/windows.md).
 */
import { windowControlChanges, type WindowControl, type WindowReadChanges } from '@boite/contracts';
import type { NativeWindow } from '../platform/types.ts';

/** How many windows' last reads a conversation keeps: a guided task moves between an app's main window and a dialog or two. */
const READ_HISTORY = 8;

/**
 * The controls a conversation read, with the window they belong to and the
 * options they were read with: numbered from 1, or with `changes` under the
 * ids of the previous read and new ones after them.
 */
export interface Snapshot {
  window: NativeWindow;
  controls: WindowControl[];
  any: boolean;
  offscreen: boolean;
}

/** The same window: its id, and the process that had it, since a closed window's id can come back. */
const sameWindow = (a: NativeWindow, b: NativeWindow) => a.id === b.id && a.pid === b.pid && a.path === b.path;

export class GuideReads {
  readonly #numbered = new Map<string, Snapshot>();
  /** Each conversation's last read of each window, newest last. */
  readonly #history = new Map<string, Snapshot[]>();

  /** The read `point <id>` takes ids from. */
  numbered(threadId: string): Snapshot | undefined {
    return this.#numbered.get(threadId);
  }

  /** Makes `snapshot` the numbered read, and its window's last read. */
  keep(threadId: string, snapshot: Snapshot): void {
    this.#numbered.set(threadId, snapshot);
    const history = (this.#history.get(threadId) ?? []).filter(one => !sameWindow(one.window, snapshot.window));
    history.push(snapshot);
    this.#history.set(threadId, history.slice(-READ_HISTORY));
  }

  /**
   * Numbers `placed`, a read of `window` in tree order. With `changes`,
   * against the conversation's last read of the window taken with the same
   * options: what appeared, and the summary. Without such a read, from 1, as
   * a plain read is.
   */
  number(threadId: string, window: NativeWindow, placed: Omit<WindowControl, 'id'>[], options: { any: boolean; offscreen: boolean; changes: boolean })
    : { snapshot: Snapshot; appeared?: WindowControl[]; changes?: WindowReadChanges } {
    const { any, offscreen, changes } = options;
    const previous = changes
      ? this.#history.get(threadId)?.find(one => sameWindow(one.window, window) && one.any === any && one.offscreen === offscreen) : undefined;
    if (!previous) {
      const snapshot = { window, controls: placed.map((control, index) => ({ id: index + 1, ...control })), any, offscreen };
      return changes ? { snapshot, changes: { compared: false, vanished: [], unchanged: 0 } } : { snapshot };
    }
    const { controls, appeared, vanished, unchanged } = windowControlChanges(previous.controls, placed);
    return { snapshot: { window, controls, any, offscreen }, appeared, changes: { compared: true, vanished, unchanged } };
  }

  delete(threadId: string): void {
    this.#numbered.delete(threadId);
    this.#history.delete(threadId);
  }

  clear(): void {
    this.#numbered.clear();
    this.#history.clear();
  }
}
