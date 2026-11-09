import { onDestroy } from 'svelte';
import { provideViewerHost, type Gallery } from './media-gallery';

/**
 * The image viewer a timeline hosts (MessageList). It belongs to the list,
 * not to the row it was opened from: a running turn moves the window of rows,
 * and the row leaving it must not close the viewer. Object URLs of rows gone
 * meanwhile wait for it to close. Built while the list is created, since it
 * provides the viewer to the rows through context.
 */
export class ListViewer {
  viewing = $state<Gallery | null>(null);
  readonly #held = new Set<string>();

  constructor() {
    provideViewerHost({ open: (gallery) => { this.viewing = gallery; this.#release(); }, release: (url) => { this.#held.add(url); this.#release(); } });
    onDestroy(() => this.close());
  }

  close(): void {
    this.viewing = null;
    this.#release();
  }

  #release(): void {
    for (const url of this.#held) if (!this.viewing?.items.some(item => item.src === url)) { URL.revokeObjectURL(url); this.#held.delete(url); }
  }
}
