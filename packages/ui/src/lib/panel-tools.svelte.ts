import { getContext, setContext } from 'svelte';

/**
 * What the showing surface tells the panel's head: `back` steps back inside
 * the surface (a phone's file to its list) before the head's arrow leaves the
 * panel, named by its `label`. `slot` is the place in the panel's strip where
 * a surface's own head (what it holds, "6 files, +67 -3", then its actions)
 * goes on a desktop (`SurfaceHead.svelte`); a phone's strip holds the thread
 * and the door, so there is none and the surface keeps that line in its body.
 */
export class PanelTools {
  back = $state<{ label: string; run: () => void } | null>(null);
  slot = $state<HTMLElement | null>(null);
}

const KEY = Symbol('panel-tools');

export function providePanelTools(): PanelTools {
  return setContext(KEY, new PanelTools());
}

/** Undefined outside a panel (a test mounting a surface alone). */
export function panelTools(): PanelTools | undefined {
  return getContext<PanelTools | undefined>(KEY);
}
