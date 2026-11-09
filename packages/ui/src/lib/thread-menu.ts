import { Archive, CircleCheck, Copy, FolderInput, GitPullRequest, MessageSquare, PencilLine, Pin, PinOff, Settings2, Sparkles, Trash2, X } from '@lucide/svelte';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { separator, type MenuItem } from './menu';
import { markDone, markDoneBlocker } from './recent.svelte';
import { archiveThread } from './archive';
import { canDeleteThread, deleteThread } from './thread-removal';
import { canMove, moveItems, pickMoveItem } from './thread-move.svelte';
import { entrustItems, pickEntrustItem } from './thread-entrust';
import { workspace } from './workspace.svelte';
import { strings } from './strings';

interface ThreadMenuOptions {
  /** Rows can open their thread; the header is already there. */
  open?: boolean;
  showDone?: boolean;
  /** Omitted where pull requests have no manual refresh action. */
  prLoading?: boolean;
  /** The view's own tools (find), first on the menu's first level. */
  tools?: MenuItem[];
  /** The bots that hold or look after the thread (the header's), first in the named group's bot rows. */
  lead?: MenuItem[];
  /** What the header knows of where it lives (its branch, its pull request watches), first in the folder rows. */
  place?: MenuItem[];
  /** A phone's menu: the path and the pull request stay on the desktop. */
  phone?: boolean;
}

/**
 * Where the thread lives: its project, its folder, its branch's pull request.
 * A phone keeps the move only; the path and the pull request stay on the desktop.
 */
function placeItems(store: Store, thread: ThreadSummary, options: ThreadMenuOptions): MenuItem[] {
  return [
    ...(options.place ?? []),
    ...(canMove(thread) ? moveItems(store, thread).map(item => ({ ...item, glyph: item.id === 'move-cancel' ? X : FolderInput })) : []),
    ...(options.phone ? [] : [
      { id: 'copy', label: strings.sidebar.copyPath, glyph: Copy, title: thread.cwd },
      ...(options.prLoading === undefined || !thread.branch || thread.branch === 'HEAD' ? [] : [{ id: 'pr', label: strings.machines.refreshPr, glyph: GitPullRequest, disabled: options.prLoading }])
    ])
  ];
}

/**
 * The named group's rows, what is done to a thread less often, in the order
 * its name says them: the bot (who holds it, the hand-off), the title made
 * again, then the folder (branch, move, path, pull request). The name is
 * built from the parts present, so it never promises a row that is not there.
 */
function manageParts(store: Store, thread: ThreadSummary, options: ThreadMenuOptions): { name: string; rows: MenuItem[] } {
  const retitling = store.retitling.includes(thread.id);
  const bot = [...(options.lead ?? []), ...entrustItems(store, thread)];
  const folder = placeItems(store, thread, options);
  const title: MenuItem[] = [{ id: 'retitle', label: retitling ? strings.sidebar.retitling : strings.sidebar.retitle, glyph: Sparkles, disabled: retitling }];
  // Named by what a user does there: the move only when a move row is in it, so the name never promises one.
  const moves = folder.some(item => item.id.startsWith('move'));
  const name = bot.length ? (moves ? strings.thread.manage : strings.thread.manageNoFolder) : moves ? strings.thread.manageNoBot : strings.thread.manageTitle;
  return { name, rows: [...bot, ...(bot.length ? [separator('sep-bot')] : []), ...title, ...(folder.length ? [separator('sep-folder')] : []), ...folder] };
}

/**
 * The named group ("Move or give to a bot", `more`, kept for the rows that
 * open it), under a way back to the thread's menu. Empty for a group of one,
 * which is a row on the first level instead. A phone folds it too, in its sheet.
 */
export function threadToolItems(store: Store, thread: ThreadSummary, options: ThreadMenuOptions = {}): MenuItem[] {
  const { name, rows } = manageParts(store, thread, options);
  if (rows.filter(item => !item.separator).length < 2) return [];
  // The way back names the level it stands on (`BackRow.svelte`), as every second level does.
  return [{ id: 'back', label: name, title: strings.sidebar.backToThreadMenu, back: true }, ...rows];
}

function doneItem(store: Store, thread: ThreadSummary): MenuItem {
  const why = markDoneBlocker(store, thread);
  return { id: 'done', label: strings.sidebar.markDone, glyph: CircleCheck, disabled: why !== null, ...(why ? { hint: why, title: why } : {}) };
}

/**
 * One menu for a thread wherever it opens (a row, its header, the phone's
 * long press, the header's menu): a short first level of what is done most
 * (the view's own Find, Rename, Pin, Mark done, Archive), one named group for
 * the rest (`threadToolItems`), then Delete apart. A row adds Open first.
 * Seven rows at most. The panels have one door of their own, the panel strip.
 */
export function threadMenuItems(store: Store, thread: ThreadSummary, options: ThreadMenuOptions = {}): MenuItem[] {
  // An incognito conversation lives on its own screen only: nothing pins, files
  // or moves it, and deleting it is what leaving does anyway.
  const kept = !thread.incognito;
  const own = options.tools ?? [];
  const group = threadToolItems(store, thread, options);
  const opening: MenuItem[] = options.open === undefined ? [] : [{ id: 'open', label: strings.common.open, glyph: MessageSquare, disabled: options.open }, separator('sep-open')];
  const items: MenuItem[] = [
    ...opening,
    ...own,
    ...(own.length ? [separator('sep-thread-tools')] : []),
    { id: 'rename', label: strings.common.rename, glyph: PencilLine },
    ...(kept ? [{ id: 'pin', label: thread.pinned ? strings.sidebar.unpin : strings.sidebar.pin, glyph: thread.pinned ? PinOff : Pin }] : []),
    ...(kept ? [
      separator('sep-archive'),
      // A ringed check: the bare one is every menu's selection mark, and Done is an action, not a chosen row.
      // Off, the row says why in its hint: a disabled action that only greys out leaves the user guessing.
      ...(options.showDone ? [doneItem(store, thread)] : []),
      { id: 'archive', label: strings.sidebar.archive, glyph: Archive }
    ] : []),
    separator('sep-tools'),
    ...(group.length ? [{ id: 'more', label: group[0]!.label, glyph: Settings2, submenu: true, hint: '›', items: group }] : manageParts(store, thread, options).rows)
  ];
  if (canDeleteThread(thread)) items.push(separator('sep-delete'), { id: 'delete', label: strings.common.delete, glyph: Trash2, danger: true });
  return items;
}

/** What a view brings to the shared rows: its own rename, its pull request lookup, where its pickers hang. */
export interface ThreadMenuView {
  rename: () => void;
  refreshPr?: () => void;
  /** The trigger the move and entrust pickers open under; without one they open where the menu stood. */
  anchor?: () => HTMLElement | null | undefined;
}

/**
 * Answers a pick of `threadMenuItems`' and `threadToolItems`' rows on the row's own store, since
 * thread ids can collide between machines. False for a row the view added
 * through `tools`, which the view answers itself.
 */
export function pickThreadAction(store: Store, thread: ThreadSummary, action: string, view: ThreadMenuView): boolean {
  switch (action) {
    case 'open': void workspace.select(store, thread.id); return true;
    case 'pin': void store.pin(thread.id, !thread.pinned); return true;
    case 'done': void markDone(store, thread); return true;
    case 'archive': void archiveThread(store, thread.id); return true;
    case 'rename': view.rename(); return true;
    case 'retitle': void store.retitle(thread.id); return true;
    case 'copy': void store.copy(thread.cwd); return true;
    case 'pr': view.refreshPr?.(); return true;
    case 'delete': void deleteThread(store, thread); return true;
  }
  const anchor = action.startsWith('move') || action.startsWith('entrust') ? view.anchor?.() : undefined;
  return pickMoveItem(store, thread, action, anchor) || pickEntrustItem(store, thread, action, anchor);
}
