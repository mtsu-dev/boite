/**
 * Every surface of the right panel by name, with its count: the list behind
 * the title bar's panel button, the phone's panel button and the phone
 * panel's own header. Terminal and Board are drawers under the chat, listed
 * here too so they open while the panel is shut.
 */
import { SquareKanban, SquareTerminal } from '@lucide/svelte';
import { browserBridge } from './browser-bridge';
import { separator, type MenuItem } from './menu';
import type { SurfaceKind } from './right-panel.svelte';
import { strings } from './strings';
import type { Store } from './store.svelte';
import { surfaceGlyph } from './surface-glyphs';
import { available as availableTo, hiddenKind, kindName } from './surface-labels';
import { work } from './work-prefs.svelte';
import { PRIMARY } from './panel-strip.svelte';

/** The kinds listed after the five the strip always shows, in this order. */
export const SECONDARY: readonly SurfaceKind[] = ['trace', 'messages', 'device'];

/** What a count reads in a list: the number and the sentence an accessible name carries. */
export type Count = { value: number; label: string } | null;

const inShell = (): boolean => typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;

/** The user's own browser needs the shell's webview, or the iframe a test page paints. */
export function panelAvailable(store: Store, kind: SurfaceKind): boolean {
  if (kind === 'browser' && !inShell()) return browserBridge.paints;
  return availableTo(kind, inShell(), store.owner);
}

/** The terminal drawer: the owner's, in a thread that runs an agent, unless this device put it away. */
export function terminalOffered(store: Store): boolean {
  const thread = store.openThread;
  return !!thread && store.owner && !thread.teamId && !thread.councilId && work.shows('header.terminal');
}

/** The kinds a list offers: what this device may open and did not put away. */
function offered(store: Store, kinds: readonly SurfaceKind[]): SurfaceKind[] {
  return kinds.filter((kind) => !hiddenKind(kind) && panelAvailable(store, kind));
}

/** The count beside the row's label, the sentence in its tooltip. */
function counted(item: MenuItem, count: Count): MenuItem {
  return count ? { ...item, count: String(count.value), title: `${item.label}, ${count.label}` } : item;
}

/**
 * The full list: the strip's five, then the drawers, then the rest. `shown` is
 * the kind in front when the panel is open, ticked in the list.
 */
export function launcherItems(store: Store, countOf: (kind: SurfaceKind) => Count, shown: SurfaceKind | null, { primary = true } = {}): MenuItem[] {
  const row = (kind: SurfaceKind): MenuItem => counted({ id: kind, label: kindName(kind), glyph: surfaceGlyph(kind), active: kind === shown }, countOf(kind));
  const key = store.keyLabel('terminal');
  const hinted = (text: string): string => (key ? `${text} (${key})` : text);
  const drawers: MenuItem[] = [
    ...(terminalOffered(store) && store.openThread
      ? [{ id: 'terminal', label: strings.rightPanel.terminal, title: hinted(strings.thread.terminalHint), glyph: SquareTerminal, active: store.terminalShown(store.openThread.id) }]
      : []),
    ...(store.openThread && store.boardAvailable() ? [{ id: 'board', label: strings.rightPanel.board, title: hinted(strings.board.open), glyph: SquareKanban, active: store.boardShown }] : [])
  ];
  const rest = [
    ...(store.openThread?.agentSessionId ? (['desk'] as SurfaceKind[]) : []),
    ...offered(store, SECONDARY)
  ];
  // Without the strip's five (the strip's own More), the list starts on the drawers.
  const groups = [primary ? offered(store, PRIMARY).map(row) : [], drawers, rest.map(row)].filter((group) => group.length > 0);
  return groups.flatMap((group, index) => (index === 0 ? group : [separator(`sep-${index}`), ...group]));
}

/** A pick from the list: a drawer toggles, a surface opens in the panel (which opens with it). */
export function pickLauncher(store: Store, id: string): void {
  if (id === 'terminal') store.toggleTerminal();
  else if (id === 'board') store.toggleBoard();
  else if (panelAvailable(store, id as SurfaceKind)) store.panel.open(id as SurfaceKind);
}
