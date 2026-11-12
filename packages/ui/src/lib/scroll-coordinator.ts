/** Geometry shared by all WindowLists in the same scroll container. */
export interface ScrollGeometry { top: number; height: number; scrollTop: number }
export interface ScrollSubscription { refresh(): void; schedule(): void; destroy(): void }

const roots = new WeakMap<HTMLElement, ScrollCoordinator>();

export function subscribeScroll(root: HTMLElement, container: HTMLElement, read: (geometry: ScrollGeometry) => void): ScrollSubscription {
  let coordinator = roots.get(root);
  if (!coordinator) { coordinator = new ScrollCoordinator(root); roots.set(root, coordinator); }
  return coordinator.subscribe(container, read);
}

class ScrollCoordinator {
  #subscribers = new Map<HTMLElement, (geometry: ScrollGeometry) => void>();
  #geometry: Omit<ScrollGeometry, 'scrollTop'> | null = null;
  #frame: number | null = null;
  #expiry: number | null = null;
  #sizes: ResizeObserver | null;

  constructor(private root: HTMLElement) {
    root.addEventListener('scroll', this.#scroll, { passive: true });
    window.addEventListener('resize', this.#schedule);
    this.#sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.#schedule);
    this.#sizes?.observe(root);
  }

  #read(): ScrollGeometry {
    if (!this.#geometry) {
      this.#geometry = { top: this.root.getBoundingClientRect().top, height: this.root.clientHeight || 600 };
      this.#expiry = requestAnimationFrame(() => { this.#expiry = null; this.#geometry = null; });
    }
    return { ...this.#geometry, scrollTop: this.root.scrollTop };
  }

  // Scroll events already arrive on the browser's frame: keep their synchronous
  // row updates, sharing the root read even if another event lands this frame.
  #scroll = (): void => {
    if (this.#frame !== null) { cancelAnimationFrame(this.#frame); this.#frame = null; }
    const geometry = this.#read();
    for (const read of this.#subscribers.values()) read(geometry);
  };

  #schedule = (): void => {
    this.#frame ??= requestAnimationFrame(() => { this.#frame = null; this.#scroll(); });
  };

  subscribe(container: HTMLElement, read: (geometry: ScrollGeometry) => void): ScrollSubscription {
    this.#subscribers.set(container, read);
    this.#sizes?.observe(container);
    const refresh = () => read(this.#read());
    refresh();
    return { refresh, schedule: this.#schedule, destroy: () => {
      this.#subscribers.delete(container);
      this.#sizes?.unobserve(container);
      if (this.#subscribers.size) return;
      this.root.removeEventListener('scroll', this.#scroll);
      window.removeEventListener('resize', this.#schedule);
      this.#sizes?.disconnect();
      if (this.#frame !== null) cancelAnimationFrame(this.#frame);
      if (this.#expiry !== null) cancelAnimationFrame(this.#expiry);
      roots.delete(this.root);
    } };
  }
}
