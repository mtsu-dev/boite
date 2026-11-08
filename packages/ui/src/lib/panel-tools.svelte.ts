import { getContext, setContext, type Snippet } from 'svelte';

/**
 * What the showing surface puts in the panel's own strip, beside its tabs:
 * one head row instead of the strip and a toolbar under it. On a phone,
 * `compact` drops the words of the way back to the chat and `nameless` the
 * showing tab's name (its glyph and tooltip stay), so one row fits both.
 */
export class PanelTools {
  bar = $state<Snippet | null>(null);
  compact = $state(false);
  nameless = $state(false);
}

const KEY = Symbol('panel-tools');

export function providePanelTools(): PanelTools {
  return setContext(KEY, new PanelTools());
}

/** Undefined outside a panel (a test mounting a surface alone): the surface draws its bar itself. */
export function panelTools(): PanelTools | undefined {
  return getContext<PanelTools | undefined>(KEY);
}
