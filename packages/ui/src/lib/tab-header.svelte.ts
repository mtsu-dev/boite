import type { MenuItem } from './menu';

/** The "+" a page lends: one action, or a menu when `items` holds several. */
export type TabCreate = { label: string; testid: string; items?: MenuItem[]; onpick: (id?: string) => void };

/**
 * A tab page's search and its one "+", lent to the phone's header so every
 * tab reads the same (MobileNavigation.svelte): the title, then the
 * magnifier and the "+" at the header's end, the field in the title's place
 * once open. A page lends them while it is on screen at a phone's width,
 * takes them back when it leaves, and lists what `query` matches.
 */
export type TabControls = { searchLabel: string; searchTestid: string; create: TabCreate | null };

class TabHeader {
  // Raw: `lend`'s release compares the very object it lent, which a deep proxy would not be.
  controls = $state.raw<TabControls | null>(null);
  query = $state('');
  /** Lends a page's controls; the function it returns takes them back and clears the search. */
  lend(controls: TabControls): () => void {
    this.controls = controls;
    return () => {
      if (this.controls !== controls) return;
      this.controls = null;
      this.query = '';
    };
  }
}

export const tabHeader = new TabHeader();
