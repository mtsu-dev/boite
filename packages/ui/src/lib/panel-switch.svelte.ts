import type { Component } from 'svelte';
import type { MenuItem } from './menu';
import type { Store } from './store.svelte';

type Glyph = Component<{ size?: number; strokeWidth?: number }>;

/**
 * What the open panel puts on its door (`PanelDoor.svelte`): the showing
 * panel's name and icon, and the list that switches it. `RightPanel.svelte`
 * writes it while it is mounted, so the door, in the entry chunk, names the
 * panel without carrying the panel's lists or its switcher. `store` says
 * whose panel it is: another machine's header keeps its plain door.
 * One plain object: a class of runes costs the entry an accessor pair per field.
 */
export const panelSwitch: {
  store: Store | null;
  name: string;
  /** The full name where the door cuts it: a file's path, a page's profile. */
  title: string;
  glyph: Glyph | null;
  /** The open door itself (`PanelSwitcher.svelte`), from the panel's chunk. */
  door: Component<{ inPanel?: boolean }> | null;
  /** Read when the list opens: the recent panels are noted after the panel shows. */
  items: () => MenuItem[];
  pick: (id: string) => void;
} = $state({ store: null, name: '', title: '', glyph: null, door: null, items: () => [], pick: () => {} });
