import { Network, SquareKanban, SquareTerminal } from '@lucide/svelte';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { separator, type MenuItem } from './menu';
import type { SurfaceKind } from './right-panel.svelte';
import { available as availableTo, kindName, offeredCards, unavailable } from './surface-labels';
import { surfaceGlyph } from './surface-glyphs';
import { work } from './work-prefs.svelte';
import { strings } from './strings';

/** The panels a thread lists first: the ones most threads have something for. The rest follow in the launcher's order. */
const LEAD: SurfaceKind[] = ['changes', 'agent-browser', 'agents', 'files'];

/** The selector's last row, which no surface kind can be called. */
export const CUSTOMIZE = 'customize';

/**
 * The one list of every panel and tool a thread can open, the panel
 * selector's (`RightPanel.svelte`), the same on a desktop and a phone: the
 * side panels by kind (the id is the kind), the drawers under the chat
 * (`terminal-toggle`, `board-toggle`), the conversations' coordination, then
 * the way to the Appearance page that hides some of them. The panel showing
 * is marked; a kind this device cannot show stays listed, greyed with why.
 */
export function panelChoices(store: Store, thread: ThreadSummary | null, options: { phone?: boolean; available?: (kind: SurfaceKind) => boolean; showing?: SurfaceKind } = {}): MenuItem[] {
  const inShell = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
  const can = options.available ?? ((kind: SurfaceKind) => availableTo(kind, inShell, store.owner));
  const offered = offeredCards().map((card) => card.kind);
  const kinds: SurfaceKind[] = [...(thread?.agentSessionId ? ['desk' as const] : []), ...LEAD.filter((kind) => offered.includes(kind)), ...offered.filter((kind) => !LEAD.includes(kind))];
  const showing = 'showing' in options ? options.showing : store.panelOpen ? store.panel.active?.kind : undefined;
  const plain = !!thread && !thread.teamId && !thread.councilId;
  const terminalKey = store.keyLabel('terminal');
  const tools: MenuItem[] = [
    ...(!options.phone && store.owner && plain && work.shows('header.terminal') ? [{
      id: 'terminal-toggle', label: strings.terminal.title, glyph: SquareTerminal, active: !!thread && store.terminalShown(thread.id),
      title: terminalKey ? `${strings.thread.terminalHint} (${terminalKey})` : strings.thread.terminalHint
    }] : []),
    ...(store.boardAvailable() ? [{ id: 'board-toggle', label: strings.board.open, glyph: SquareKanban, active: store.boardShown }] : []),
    ...(plain && !thread.agentSessionId ? [{ id: 'coordination', label: strings.coordination.heading, glyph: Network }] : [])
  ];
  return [
    ...kinds.map((kind): MenuItem => ({
      id: kind,
      label: kindName(kind),
      glyph: surfaceGlyph(kind),
      active: kind === showing,
      ...(can(kind) ? {} : { disabled: true, hint: unavailable() })
    })),
    ...(tools.length ? [separator('sep-tools'), ...tools] : []),
    separator('sep-customize'),
    { id: CUSTOMIZE, label: strings.controls.customize }
  ];
}
