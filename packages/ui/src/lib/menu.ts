import type { Component } from 'svelte';
import type { Project } from '@boite/contracts';
import type { Store } from './store.svelte';

/** One row of a popover or context menu. A row with `separator` draws a rule and nothing else. */
export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  /** Said on hover rather than printed under the label. */
  title?: string;
  /** A lucide icon drawn before the label, in the live colour when `live`. */
  glyph?: Component<{ size?: number; strokeWidth?: number }>;
  live?: boolean;
  /** A project's tile before the label: its logo, its stack's mark or its initial, read through the Store that owns it. */
  projectTile?: { project: Project; store: Store };
  status?: { tone: 'success' | 'warning' | 'danger' | 'neutral' | 'offline'; label: string };
  /** The chosen row of a list that is not a toggle: drawn with the same check as `checked`. */
  active?: boolean;
  /** A persistent toggle, announced and drawn as a checkbox in the context menu. */
  checked?: boolean;
  /** With `checked`: one choice of several, marked with a check instead of a switch. */
  radio?: boolean;
  /** A row that took over a button keeps that button's test id. */
  testid?: string;
  icon?: 'settings';
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** Opens another list in the same menu: ArrowRight picks it, as Enter does. */
  submenu?: boolean;
  /** With `submenu`: the rows it opens, which `Menu.svelte` swaps in itself; without, the caller does. */
  items?: MenuItem[];
  /** Goes back to the list a submenu came from: ArrowLeft picks it from anywhere in that submenu. */
  back?: boolean;
}

export function separator(id = 'sep'): MenuItem {
  return { id, label: '', separator: true };
}

/**
 * One order for every menu and sheet: a destructive row comes last, behind a
 * rule, wherever its caller listed it, so a thumb running down a list meets
 * it only at the end. A list already ending on it comes back as it was.
 */
export function dangerLast(items: MenuItem[]): MenuItem[] {
  const last = items.findLastIndex((item) => !item.separator && !item.danger);
  if (!items.some((item, at) => item.danger && !item.separator && at < last)) return items;
  return [...items.filter((item) => !item.danger), separator('sep-danger'), ...items.filter((item) => item.danger)];
}
