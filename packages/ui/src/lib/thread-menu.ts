import { Archive, ArrowLeft, CircleCheck, Copy, FolderGit2, FolderInput, GitPullRequest, MessageSquare, PencilLine, Pin, PinOff, Sparkles, Trash2, X } from '@lucide/svelte';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { separator, type MenuItem } from './menu';
import { canMarkDone, markDone } from './recent.svelte';
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
  /** A phone's menu: the path and the pull request stay on the desktop. */
  phone?: boolean;
}

/**
 * Where the thread lives: its project, its folder, its branch's pull request.
 * A phone keeps the move only; the path and the pull request stay on the desktop.
 */
function placeItems(store: Store, thread: ThreadSummary, options: ThreadMenuOptions): MenuItem[] {
  return [
    ...(canMove(thread) ? moveItems(store, thread).map(item => ({ ...item, glyph: item.id === 'move-cancel' ? X : FolderInput })) : []),
    ...(options.phone ? [] : [
      { id: 'copy', label: strings.sidebar.copyPath, glyph: Copy, title: thread.cwd },
      ...(options.prLoading === undefined || !thread.branch || thread.branch === 'HEAD' ? [] : [{ id: 'pr', label: strings.machines.refreshPr, glyph: GitPullRequest, disabled: options.prLoading }])
    ])
  ];
}

/** A group of one is a row on the first level, and a phone has no second level: only a desktop folds two or more. */
function folds(place: MenuItem[], options: ThreadMenuOptions): boolean {
  return !options.phone && place.length > 1;
}

/**
 * The named group "Project and branch" (`more`, kept for the rows that open
 * it), under a way back to the thread's menu: the move, the path and the pull
 * request. Empty where the first level already holds them.
 */
export function threadToolItems(store: Store, thread: ThreadSummary, options: ThreadMenuOptions = {}): MenuItem[] {
  const place = placeItems(store, thread, options);
  if (!folds(place, options)) return [];
  return [{ id: 'back', label: strings.sidebar.backToThreadMenu, glyph: ArrowLeft, back: true }, separator('back-sep'), ...place];
}

/**
 * One menu for a thread wherever it opens (a row, its header, the phone's
 * long press, the header's menu), holding only what is done to the thread,
 * every path named for what it holds: the view's own tools (Find in this
 * thread), what it is called and who has it (Rename, Regenerate title, Pin,
 * Hand off), where it stands (Mark done, Archive), where it lives (Project
 * and branch, or its one row), then Delete apart. A row adds Open first.
 * The panels have one door of their own, the panel selector.
 */
export function threadMenuItems(store: Store, thread: ThreadSummary, options: ThreadMenuOptions = {}): MenuItem[] {
  // An incognito conversation lives on its own screen only: nothing pins, files
  // or moves it, and deleting it is what leaving does anyway.
  const kept = !thread.incognito;
  const retitling = store.retitling.includes(thread.id);
  const own = options.tools ?? [];
  const place = placeItems(store, thread, options);
  const opening: MenuItem[] = options.open === undefined ? [] : [{ id: 'open', label: strings.common.open, glyph: MessageSquare, disabled: options.open }, separator('sep-open')];
  const items: MenuItem[] = [
    ...opening,
    ...own,
    ...(own.length ? [separator('sep-thread-tools')] : []),
    { id: 'rename', label: strings.common.rename, glyph: PencilLine },
    { id: 'retitle', label: retitling ? strings.sidebar.retitling : strings.sidebar.retitle, glyph: Sparkles, disabled: retitling },
    ...(kept ? [{ id: 'pin', label: thread.pinned ? strings.sidebar.unpin : strings.sidebar.pin, glyph: thread.pinned ? PinOff : Pin }] : []),
    ...entrustItems(store, thread),
    ...(kept ? [
      separator('sep-archive'),
      // A ringed check: the bare one is every menu's selection mark, and Done is an action, not a chosen row.
      ...(options.showDone ? [{ id: 'done', label: strings.sidebar.markDone, glyph: CircleCheck, disabled: !canMarkDone(store, thread) }] : []),
      { id: 'archive', label: strings.sidebar.archive, glyph: Archive }
    ] : []),
    ...(place.length ? [separator('sep-tools')] : []),
    ...(folds(place, options) ? [{ id: 'more', label: strings.thread.placeActions, glyph: FolderGit2, submenu: true, hint: '›' }] : place)
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
