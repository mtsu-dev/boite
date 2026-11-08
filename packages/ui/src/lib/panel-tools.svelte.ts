import { getContext, setContext, type Snippet } from 'svelte';
import type { MenuItem } from './menu';

/**
 * What the showing surface puts in the panel's own strip, beside its tabs:
 * one head row instead of the strip and a toolbar under it. On a phone the
 * head is one back arrow and a text title that opens the selector, so a
 * surface can also name its page there: `title` in place of the panel's name
 * (Changes says "Changed files"), `detail` as the title's second line (the
 * file being read), `items` as its own rows atop the selector's list (its
 * files, its refresh) with `pick` to act on them, and `back` to step back
 * inside the surface (from a file to the list) before the arrow leaves the
 * panel, named by its `label`. `pick` answers true when the row was its own.
 */
export class PanelTools {
  bar = $state<Snippet | null>(null);
  title = $state<string | null>(null);
  detail = $state<string | null>(null);
  items = $state<MenuItem[]>([]);
  pick = $state<((id: string) => boolean) | null>(null);
  back = $state<{ label: string; run: () => void } | null>(null);
}

const KEY = Symbol('panel-tools');

export function providePanelTools(): PanelTools {
  return setContext(KEY, new PanelTools());
}

/** Undefined outside a panel (a test mounting a surface alone): the surface draws its bar itself. */
export function panelTools(): PanelTools | undefined {
  return getContext<PanelTools | undefined>(KEY);
}
