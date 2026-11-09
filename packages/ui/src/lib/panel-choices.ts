import { LayoutGrid, Network, SquareKanban, SquareTerminal } from '@lucide/svelte';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { separator, type MenuItem } from './menu';
import type { SurfaceKind } from './right-panel.svelte';
import { available as availableTo, kindName, offeredCards, unavailable } from './surface-labels';
import { surfaceGlyph } from './surface-glyphs';
import { agentMailFor } from './agent-mail';
import { work } from './work-prefs.svelte';
import { fill, strings } from './strings';

/** The selector's last row, which no surface kind can be called. */
export const CUSTOMIZE = 'customize';
/** The short list's way to every panel, and the full list's way back. */
export const ALL_PANELS = 'all-panels';
export const IN_USE = 'panels-in-use';

/** The full list's groups, in order. A kind no group names joins the last. */
const GROUPS: { name: () => string; ids: string[] }[] = [
  { name: () => strings.rightPanel.groups.work, ids: ['changes', 'files', 'agent-browser', 'device'] },
  { name: () => strings.rightPanel.groups.agents, ids: ['desk', 'agents', 'messages', 'coordination'] },
  { name: () => strings.rightPanel.groups.tools, ids: ['terminal-toggle', 'board-toggle', 'tasks', 'trace'] }
];

/** Always on the short list, ahead of the panels in use. */
const FIRST = ['changes', 'files'];
/** The panels a newcomer knows by name, in the order the way to every panel names them. */
const KNOWN = ['terminal-toggle', 'agent-browser', 'board-toggle', 'messages', 'agents', 'tasks', 'device', 'trace', 'coordination', 'desk'];

/**
 * The way to every panel, named by what it holds past the short list: "Terminal,
 * Browser and 6 more", so a user can tell what is behind it before opening it.
 */
export function morePanelsLabel(names: string[]): string {
  const words = strings.rightPanel.morePanels;
  if (names.length === 0) return strings.rightPanel.allPanels;
  const [first, second] = names as [string, string?];
  if (!second) return fill(words.one, { first });
  if (names.length === 2) return fill(words.two, { first, second });
  return fill(words.many, { first, second, count: String(names.length - 2) });
}

/** The panels picked last, newest first: they lead the short list, a click from the header. */
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

/** Known names first, in their order; the others after, as the groups list them. */
function rank(id: string): number {
  const at = KNOWN.indexOf(id);
  return at === -1 ? KNOWN.length : at;
}

/**
 * The panels this thread has used or has something for: its open tabs, the
 * drawers it shows, a bot's desk, its subagents and workflows, its letters,
 * and its changes once `changes` counts some.
 */
export function usedPanels(store: Store, thread: ThreadSummary | null, open: SurfaceKind[], changes: number | null): Set<string> {
  const used = new Set<string>(open.map((kind) => (kind === 'file' ? 'files' : kind)));
  if (!thread) return used;
  if (thread.agentSessionId) used.add('desk');
  const delegation = store.delegation;
  if ((delegation?.rootThreadId === thread.id && delegation.agents.length > 0) || store.workflowsOf(thread.id).length > 0) used.add('agents');
  if (agentMailFor(store, thread.id).length > 0) used.add('messages');
  if (changes) used.add('changes');
  if (store.terminalShown(thread.id)) used.add('terminal-toggle');
  if (store.boardShown) used.add('board-toggle');
  return used;
}

/**
 * The panel selector's list (`RightPanel.svelte`), the same on a desktop and
 * a phone. Short: the panels picked last, Changes, Files and the panels in `used`, then one row to
 * every panel. Full (`full`, or when the short one would hold nothing or everything): every
 * panel and tool in named groups, then the Appearance page that hides some.
 * Ids are the kinds, plus the drawers (`terminal-toggle`, `board-toggle`) and
 * `coordination`. The panel showing is marked; a kind this device cannot show
 * stays listed, greyed with why.
 */
export function panelChoices(store: Store, thread: ThreadSummary | null, options: { phone?: boolean; available?: (kind: SurfaceKind) => boolean; showing?: SurfaceKind; used?: ReadonlySet<string>; full?: boolean } = {}): MenuItem[] {
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

  const grouped = GROUPS.map((group, index) => ({
    name: group.name(),
    ids: [...group.ids, ...(index === GROUPS.length - 1 ? [...rows.keys()].filter((id) => !GROUPS.some((one) => one.ids.includes(id))) : [])].filter((id) => rows.has(id))
  }));
  const used = options.used ?? new Set<string>();
  // The panels picked last lead, then Changes and Files, what a first look at a thread wants, used or not.
  const recent = recentPanels().filter((id) => rows.has(id));
  const short = [...recent, ...grouped.flatMap((group) => group.ids).filter((id) => !recent.includes(id) && (FIRST.includes(id) || used.has(id) || rows.get(id)?.active))];
  if (!options.full && short.length > 0 && short.length < rows.size) {
    const rest = [...rows.keys()].filter((id) => !short.includes(id)).sort((a, b) => rank(a) - rank(b)).map((id) => rows.get(id)!.label);
    return [...short.map((id) => rows.get(id)!), separator('sep-all'), { id: ALL_PANELS, label: morePanelsLabel(rest), title: strings.rightPanel.allPanels, glyph: LayoutGrid, submenu: true }];
  }
  const back: MenuItem[] = options.full && short.length > 0 && short.length < rows.size ? [{ id: IN_USE, label: strings.rightPanel.allPanels, title: strings.rightPanel.inUse, back: true }] : [];
  return [
    ...back,
    ...grouped.filter((group) => group.ids.length > 0).flatMap((group) => [{ ...separator(`sep-${group.ids[0]}`), label: group.name }, ...group.ids.map((id) => rows.get(id)!)]),
    separator('sep-customize'),
    { id: CUSTOMIZE, label: strings.controls.customize, title: FORMERLY[CUSTOMIZE]!() }
  ];
}
