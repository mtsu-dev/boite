import { Network, SquareKanban, SquareTerminal } from '@lucide/svelte';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { separator, type MenuItem } from './menu';
import type { SurfaceKind } from './right-panel.svelte';
import { available as availableTo, kindName, offeredCards, unavailable } from './surface-labels';
import { surfaceGlyph } from './surface-glyphs';
import { work } from './work-prefs.svelte';
import { strings } from './strings';

/** The selector's last row, which no surface kind can be called. */
export const CUSTOMIZE = 'customize';

/** The full list's groups, in order. A kind no group names joins the last. */
const GROUPS: { name: () => string; ids: string[] }[] = [
  { name: () => strings.rightPanel.groups.work, ids: ['changes', 'files', 'agent-browser', 'device'] },
  { name: () => strings.rightPanel.groups.agents, ids: ['desk', 'agents', 'messages', 'coordination'] },
  { name: () => strings.rightPanel.groups.tools, ids: ['terminal-toggle', 'board-toggle', 'tasks', 'trace'] }
];

/**
 * The panels each thread used, newest first, by Store and thread: the
 * launcher's first group. Kept for the session only.
 */
const used = new WeakMap<Store, Map<string, string[]>>();

/** The row a surface kind is listed under: a file tab counts as Files, a page as the Browser. */
function rowOf(kind: string): string {
  return kind === 'file' ? 'files' : kind === 'browser' ? 'agent-browser' : kind;
}

/** A kind's place in the launcher's groups, kept still by the used ones: a panel switch slides in from the new one's side. */
export function panelPlace(kind: string): number {
  const ids = GROUPS.flatMap((group) => group.ids);
  const at = ids.indexOf(rowOf(kind));
  return at < 0 ? ids.length : at;
}

/** A panel or tool was shown or picked in a thread: it moves to the front of that thread's used ones. */
export function notePanelUse(store: Store, thread: string, id: string): void {
  const threads = used.get(store) ?? new Map<string, string[]>();
  used.set(store, threads);
  const row = rowOf(id);
  const list = threads.get(thread) ?? [];
  if (list[0] !== row) threads.set(thread, [row, ...list.filter((one) => one !== row)]);
}

/** At most this many rows in the used group: a short list read at a glance, the rest stay in their families. */
export const USED_MAX = 4;

/**
 * The panels this thread really showed or picked (noted), newest first. When
 * nothing is noted yet, the showing panel alone: an open tab the thread never
 * looked at stays in its own group, so the section is not every open tab.
 */
export function usedPanels(store: Store, thread: string | null, showing?: string): string[] {
  const noted = thread === null ? [] : (used.get(store)?.get(thread) ?? []);
  return noted.length > 0 ? [...noted] : showing ? [rowOf(showing)] : [];
}

/** A renamed row says its old name on hover, for the hands that knew it. */
const FORMERLY: Record<string, () => string> = {
  trace: () => strings.rightPanel.formerly.trace,
  tasks: () => strings.rightPanel.formerly.tasks,
  messages: () => strings.rightPanel.formerly.messages,
  coordination: () => strings.rightPanel.formerly.coordination,
  [CUSTOMIZE]: () => strings.rightPanel.formerly.customize
};

/**
 * The plain line under every row: what the panel holds. The board and the
 * goal both hold work to do: theirs say whose, the project's or the thread's.
 */
const ROLES: Record<string, () => string> = {
  changes: () => strings.rightPanel.roles.changes,
  files: () => strings.rightPanel.roles.files,
  'agent-browser': () => strings.rightPanel.roles.browser,
  device: () => strings.rightPanel.roles.device,
  desk: () => strings.rightPanel.roles.desk,
  agents: () => strings.rightPanel.roles.agents,
  messages: () => strings.rightPanel.roles.messages,
  coordination: () => strings.rightPanel.roles.coordination,
  'terminal-toggle': () => strings.rightPanel.roles.terminal,
  'board-toggle': () => strings.rightPanel.roles.board,
  tasks: () => strings.rightPanel.roles.tasks,
  trace: () => strings.rightPanel.roles.trace,
  [CUSTOMIZE]: () => strings.rightPanel.roles.customize
};

/**
 * The panel launcher's list (`PanelSwitcher.svelte`, shown by the door), the
 * same on a desktop and a phone: every panel by name in one scroll, nothing
 * behind a door. The ones this thread used lead, newest first (`used`, from
 * `usedPanels`); the rest follow in their named groups (Work, Agents, Tools),
 * then the Appearance page that hides some. Every row says in one line what
 * it holds. Ids are the kinds, plus the drawers (`terminal-toggle`,
 * `board-toggle`) and `coordination`. The panel showing is checked; a kind
 * this device cannot show stays listed, greyed with why.
 */
export function panelChoices(store: Store, thread: ThreadSummary | null, options: { phone?: boolean; available?: (kind: SurfaceKind) => boolean; showing?: SurfaceKind; used?: readonly string[]; plugins?: readonly MenuItem[] } = {}): MenuItem[] {
  const inShell = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
  const can = options.available ?? ((kind: SurfaceKind) => availableTo(kind, inShell, store.owner));
  const showing = 'showing' in options ? options.showing : store.panelOpen ? store.panel.active?.kind : undefined;
  const plain = !!thread && !thread.teamId && !thread.councilId;
  const terminalKey = store.keyLabel('terminal');
  const kinds: SurfaceKind[] = [...(thread?.agentSessionId ? ['desk' as const] : []), ...offeredCards().map((card) => card.kind)];
  const rows = new Map<string, MenuItem>();
  for (const kind of kinds) {
    rows.set(kind, {
      id: kind,
      label: kindName(kind),
      glyph: surfaceGlyph(kind),
      active: kind === showing,
      ...(can(kind) ? {} : { disabled: true, hint: unavailable() })
    });
  }
  if (!options.phone && store.owner && plain && work.shows('header.terminal')) {
    rows.set('terminal-toggle', {
      id: 'terminal-toggle', label: strings.terminal.title, glyph: SquareTerminal, active: !!thread && store.terminalShown(thread.id),
      title: terminalKey ? `${strings.thread.terminalHint} (${terminalKey})` : strings.thread.terminalHint
    });
  }
  if (store.boardAvailable()) rows.set('board-toggle', { id: 'board-toggle', label: strings.board.open, glyph: SquareKanban, active: store.boardShown });
  if (plain && !thread.agentSessionId) rows.set('coordination', { id: 'coordination', label: strings.coordination.heading, glyph: Network });
  for (const [id, row] of rows) {
    if (FORMERLY[id] && !row.title) row.title = FORMERLY[id]();
    if (ROLES[id] && !row.hint) row.hint = ROLES[id]();
  }

  // Each row once: a used panel leads in its own group and leaves its usual one.
  const recent = (options.used ?? []).filter((id) => rows.has(id)).slice(0, USED_MAX);
  const groups = [
    { name: strings.rightPanel.groups.used, ids: recent },
    ...GROUPS.map((group, index) => ({
      name: group.name(),
      ids: [...group.ids, ...(index === GROUPS.length - 1 ? [...rows.keys()].filter((id) => !GROUPS.some((one) => one.ids.includes(id))) : [])].filter((id) => rows.has(id) && !recent.includes(id))
    }))
  ];
  return [
    ...groups.filter((group) => group.ids.length > 0).flatMap((group) => [{ ...separator(`sep-${group.ids[0]}`), label: group.name }, ...group.ids.map((id) => rows.get(id)!)]),
    // The tabs plugin interfaces add, after the panels and before the way to customize.
    ...(options.plugins?.length ? [separator('sep-plugins'), ...options.plugins] : []),
    separator('sep-customize'),
    { id: CUSTOMIZE, label: strings.controls.customize, title: FORMERLY[CUSTOMIZE]!(), hint: ROLES[CUSTOMIZE]!() }
  ];
}
