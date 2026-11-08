import { Archive, ArrowLeft, Check, Copy, FolderInput, GitPullRequest, MessageSquare, PencilLine, Pin, PinOff, Sparkles, SquareKanban, SquareTerminal, Trash2, Wrench, X } from '@lucide/svelte';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { separator, type MenuItem } from './menu';
import { canMarkDone, markDone } from './recent.svelte';
import { archiveThread } from './archive';
import { canDeleteThread, deleteThread } from './thread-removal';
import { canMove, moveItems, pickMoveItem } from './thread-move.svelte';
import { entrustItems, pickEntrustItem } from './thread-entrust';
import { workspace } from './workspace.svelte';
import type { SurfaceKind } from './right-panel.svelte';
import { available, kindName, offeredCards } from './surface-labels';
import { surfaceGlyph } from './surface-glyphs';
import { work } from './work-prefs.svelte';
import { strings } from './strings';

interface ThreadMenuOptions {
  /** Rows can open their thread; the header is already there. */
  open?: boolean;
  showDone?: boolean;
  /** Omitted where pull requests have no manual refresh action. */
  prLoading?: boolean;
  /** The view's own tools (find, coordination), listed in Tools after the panels. */
  tools?: MenuItem[];
  /** A phone's menu: the path and the pull request stay on the desktop, and so does the terminal. */
  phone?: boolean;
  /** Kept for the callers that still pass it: every thread menu is grouped now. */
  grouped?: boolean;
  /** Tools lists the panels; a phone row leaves them out, since the list screen cannot show a panel. Default: not on a phone. */
  panels?: boolean;
}

/** The panels a thread lists first: the ones most threads have something for. The rest follow in the launcher's order. */
const LEAD: SurfaceKind[] = ['changes', 'agent-browser', 'agents', 'files'];

/**
 * The thread's panels and the drawers under its chat, one row each, with the
 * ids the header's panel menu always gave them (`kind:<kind>`,
 * `terminal-toggle`, `board-toggle`): the head of Tools, and the panel
 * button's own list.
 */
export function panelItems(store: Store, thread: ThreadSummary, options: { phone?: boolean } = {}): MenuItem[] {
  const here = store.openThread?.id === thread.id;
  const shows = (kind: SurfaceKind) => here && store.panelOpen && store.panel.active?.kind === kind;
  const offered = offeredCards().map(card => card.kind);
  const kinds: SurfaceKind[] = [...(thread.agentSessionId ? ['desk' as const] : []), ...LEAD.filter(kind => offered.includes(kind)), ...offered.filter(kind => !LEAD.includes(kind))];
  const inShell = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
  const terminalKey = store.keyLabel('terminal');
  const drawers: MenuItem[] = [
    ...(!options.phone && store.owner && !thread.teamId && !thread.councilId && work.shows('header.terminal') ? [{
      id: 'terminal-toggle', label: strings.terminal.title, glyph: SquareTerminal, active: here && store.terminalShown(thread.id),
      title: terminalKey ? `${strings.thread.terminalHint} (${terminalKey})` : strings.thread.terminalHint
    }] : []),
    ...(store.boardAvailable() ? [{ id: 'board-toggle', label: strings.board.open, glyph: SquareKanban, active: here && store.boardShown }] : [])
  ];
  return [
    ...kinds.filter(kind => available(kind, inShell, store.owner)).map((kind): MenuItem => ({ id: `kind:${kind}`, label: kindName(kind), glyph: surfaceGlyph(kind), active: shows(kind) })),
    ...(drawers.length ? [separator('sep-drawers'), ...drawers] : [])
  ];
}

/**
 * Tools: every panel and tool of the thread in one list, under a way back to
 * the thread's menu. The panels, then the view's tools, then what changes the
 * thread's place or name (a new title by the agent, a move, the path, the pull
 * request). `ids` renames a row for a view whose tests and keys knew it by
 * another id (the phone header's `changes`, `phone-browser-toggle`).
 */
export function threadToolItems(store: Store, thread: ThreadSummary, options: ThreadMenuOptions & { ids?: Record<string, string> } = {}): MenuItem[] {
  const retitling = store.retitling.includes(thread.id);
  const panels = (options.panels ?? !options.phone) ? panelItems(store, thread, options).map(item => ({ ...item, id: options.ids?.[item.id] ?? item.id })) : [];
  const own = options.tools ?? [];
  return [
    { id: 'back', label: strings.sidebar.backToThreadMenu, glyph: ArrowLeft, back: true },
    separator('back-sep'),
    ...panels,
    ...(panels.length && own.length ? [separator('sep-view-tools')] : []),
    ...own,
    ...(panels.length || own.length ? [separator('sep-thread-tools')] : []),
    { id: 'retitle', label: retitling ? strings.sidebar.retitling : strings.sidebar.retitle, glyph: Sparkles, disabled: retitling },
    ...(canMove(thread) ? moveItems(store, thread).map(item => ({ ...item, glyph: item.id === 'move-cancel' ? X : FolderInput })) : []),
    ...(options.phone ? [] : [
      { id: 'copy', label: strings.sidebar.copyPath, glyph: Copy, title: thread.cwd },
      ...(options.prLoading === undefined || !thread.branch || thread.branch === 'HEAD' ? [] : [{ id: 'pr', label: strings.machines.refreshPr, glyph: GitPullRequest, disabled: options.prLoading }])
    ])
  ];
}

/**
 * One menu for a thread wherever it opens (a row, its header, the phone's
 * long press, the header's menu), with two intents kept apart: what is done
 * to the thread, then one Tools entry for everything it can open. What it is
 * called and who has it (Rename, Pin, Hand off), then where it stands (Mark
 * done, Archive), then Tools (`threadToolItems`), then Delete apart. A row
 * adds Open first; Archive is on every thread that can be kept.
 */
export function threadMenuItems(store: Store, thread: ThreadSummary, options: ThreadMenuOptions = {}): MenuItem[] {
  // An incognito conversation lives on its own screen only: nothing pins, files
  // or moves it, and deleting it is what leaving does anyway.
  const kept = !thread.incognito;
  const opening: MenuItem[] = options.open === undefined ? [] : [{ id: 'open', label: strings.common.open, glyph: MessageSquare, disabled: options.open }, separator('sep-open')];
  const items: MenuItem[] = [
    ...opening,
    { id: 'rename', label: strings.common.rename, glyph: PencilLine },
    ...(kept ? [{ id: 'pin', label: thread.pinned ? strings.sidebar.unpin : strings.sidebar.pin, glyph: thread.pinned ? PinOff : Pin }] : []),
    ...entrustItems(store, thread),
    ...(kept ? [
      separator('sep-archive'),
      ...(options.showDone ? [{ id: 'done', label: strings.sidebar.markDone, glyph: Check, disabled: !canMarkDone(store, thread) }] : []),
      { id: 'archive', label: strings.sidebar.archive, glyph: Archive }
    ] : []),
    separator('sep-tools'),
    { id: 'more', label: strings.thread.toolsSection, glyph: Wrench, submenu: true, ...(options.phone ? {} : { hint: '›' }) }
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

/** A panel opens beside its thread: a row's thread is opened first. */
async function reach(store: Store, thread: ThreadSummary): Promise<void> {
  if (store.openThread?.id !== thread.id) await workspace.select(store, thread.id);
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
    case 'terminal-toggle': void reach(store, thread).then(() => store.toggleTerminal()); return true;
    case 'board-toggle': void reach(store, thread).then(() => store.toggleBoard()); return true;
  }
  if (action.startsWith('kind:')) {
    void reach(store, thread).then(() => store.panel.open(action.slice('kind:'.length) as SurfaceKind));
    return true;
  }
  const anchor = action.startsWith('move') || action.startsWith('entrust') ? view.anchor?.() : undefined;
  return pickMoveItem(store, thread, action, anchor) || pickEntrustItem(store, thread, action, anchor);
}
