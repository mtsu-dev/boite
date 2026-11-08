import { getContext, setContext } from 'svelte';

/**
 * What the showing surface tells the panel's head, which holds the selector
 * and the close only: `back` steps back inside the surface (a phone's file to
 * its list) before the head's arrow leaves the panel, named by its `label`.
 * A surface's own controls (its file, its refresh, View) stay in its body.
 */
export class PanelTools {
  back = $state<{ label: string; run: () => void } | null>(null);
}

const KEY = Symbol('panel-tools');

export function providePanelTools(): PanelTools {
  return setContext(KEY, new PanelTools());
}

/** Undefined outside a panel (a test mounting a surface alone). */
export function panelTools(): PanelTools | undefined {
  return getContext<PanelTools | undefined>(KEY);
}
