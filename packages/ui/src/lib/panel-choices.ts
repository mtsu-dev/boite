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

/** The panels picked last, newest first: a short group on top of the list. */
const RECENT_KEY = 'boite.panels.recent';
const RECENT_MAX = 3;

function recentPanels(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** A panel or tool was picked or shown: it moves to the front of the recent ones. A file tab counts as Files. */
export function notePanelUse(id: string): void {
  const kind = id === 'file' ? 'files' : id;
  const list = recentPanels();
  if (list[0] === kind) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([kind, ...list.filter((one) => one !== kind)].slice(0, RECENT_MAX)));
  } catch {
    /* a browser that refuses storage keeps the plain order */
  }
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
 * The panel selector's list (`RightPanel.svelte`), the same on a desktop and
 * a phone: every panel by name in one scroll, nothing behind a door. The ones
 * picked last lead as a short Recent group; the rest follow in their named
 * groups (Work, Agents, Tools), then the Appearance page that hides some.
 * Ids are the kinds, plus the drawers (`terminal-toggle`, `board-toggle`) and
 * `coordination`. The panel showing is checked; a kind this device cannot show
 * stays listed, greyed with why.
 */
export function panelChoices(store: Store, thread: ThreadSummary | null, options: { phone?: boolean; available?: (kind: SurfaceKind) => boolean; showing?: SurfaceKind } = {}): MenuItem[] {
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
  // The board and the task manager both hold work to do: a line under each says whose.
  if (store.boardAvailable()) rows.set('board-toggle', { id: 'board-toggle', label: strings.board.open, hint: strings.rightPanel.roles.board, glyph: SquareKanban, active: store.boardShown });
  const tasks = rows.get('tasks');
  if (tasks && !tasks.hint) tasks.hint = strings.rightPanel.roles.tasks;
  if (plain && !thread.agentSessionId) rows.set('coordination', { id: 'coordination', label: strings.coordination.heading, glyph: Network });
  for (const [id, row] of rows) if (FORMERLY[id] && !row.title) row.title = FORMERLY[id]();

  // Each row once: a recent panel leads in its own group and leaves its usual one.
  const recent = recentPanels().filter((id) => rows.has(id));
  const groups = [
    { name: strings.rightPanel.groups.recent, ids: recent },
    ...GROUPS.map((group, index) => ({
      name: group.name(),
      ids: [...group.ids, ...(index === GROUPS.length - 1 ? [...rows.keys()].filter((id) => !GROUPS.some((one) => one.ids.includes(id))) : [])].filter((id) => rows.has(id) && !recent.includes(id))
    }))
  ];
  return [
    ...groups.filter((group) => group.ids.length > 0).flatMap((group) => [{ ...separator(`sep-${group.ids[0]}`), label: group.name }, ...group.ids.map((id) => rows.get(id)!)]),
    separator('sep-customize'),
    { id: CUSTOMIZE, label: strings.controls.customize, title: FORMERLY[CUSTOMIZE]!() }
  ];
}
