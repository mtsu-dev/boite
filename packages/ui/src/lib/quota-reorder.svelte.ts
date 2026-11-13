/**
 * Reordering accounts by priority, by pointer, touch or keyboard: the limits popup (QuotaOverview.svelte) and the
 * Limits page (UsageLimits.svelte) share it, so a phone reorders its priorities as the tray and the desktop do.
 *
 * A press on an item's handle becomes a drag only once it moves 6 px, so a click or a tap stays free. A touch drag
 * starts on the item's `grip` only (its name): swiping the bars keeps the list's native scrolling. Near the scroller's
 * edges the list scrolls on its own while an item is held. Arrow keys, Home and End move the focused item.
 */
export type QuotaReorderOptions = {
  /** The saved priority, account ids first to last. */
  order: () => string[];
  /** Saves a new priority; absent, nothing reorders. */
  onreorder: () => ((order: string[]) => Promise<boolean>) | undefined;
  /** What one item is, matched from the pointer: it carries `data-account-id`, or the `attribute` below. */
  item: string;
  /** The `dataset` key that names an item, `accountId` (`data-account-id`) by default: the app rail reorders bots and teams by theirs. */
  attribute?: string;
  /** Where a touch drag may start inside an item. */
  grip: string;
  /** The box that scrolls while an item is held near its edges. */
  scroller: (root: HTMLElement) => HTMLElement | null;
};

export class QuotaReorder {
  draft = $state<string[] | null>(null);
  dragging = $state<string | null>(null);
  saving = $state(false);
  #root: HTMLElement | null = null;
  #pointer: number | null = null;
  #candidate: string | null = null;
  #pressedAt = { x: 0, y: 0 };
  #suppressClick = false;
  #clickTimer = 0;
  #original: string[] = [];
  #lastPoint = { x: 0, y: 0 };
  #scrolling = 0;
  #shown: string[] = [];
  readonly #options: QuotaReorderOptions;

  constructor(options: QuotaReorderOptions) { this.#options = options; }

  get enabled(): boolean { return !!this.#options.onreorder(); }

  /** The rows in the priority on screen: the one being dragged, else the saved one; unknown ids last, in their given order. */
  sort<T>(rows: readonly T[], idOf: (row: T) => string = (row) => (row as { accountId: string }).accountId): T[] {
    const priority = new Map((this.draft ?? this.#options.order()).map((id, index) => [id, index]));
    const sorted = [...rows].sort((a, b) => (priority.get(idOf(a)) ?? Infinity) - (priority.get(idOf(b)) ?? Infinity));
    this.#shown = sorted.map(idOf);
    return sorted;
  }

  async #save(ids: string[]) {
    const onreorder = this.#options.onreorder();
    if (!onreorder) return;
    const order = this.#options.order();
    this.saving = true;
    try { await onreorder([...ids, ...order.filter((id) => !ids.includes(id))]); }
    finally { this.saving = false; this.draft = null; }
  }

  #scroll = () => {
    if (!this.dragging || !this.#root) return;
    const body = this.#options.scroller(this.#root);
    if (body) {
      const box = body.getBoundingClientRect();
      const { x, y } = this.#lastPoint;
      const delta = y < box.top + 32 ? -8 : y > box.bottom - 32 ? 8 : 0;
      if (delta) { body.scrollTop += delta; this.#place(x, y); }
    }
    this.#scrolling = requestAnimationFrame(this.#scroll);
  };

  /** The list's action: it follows the pointer once a drag starts and swallows the click that ends one. */
  track = (node: HTMLElement) => {
    this.#root = node;
    const move = (event: PointerEvent) => this.#move(event);
    const end = (event: PointerEvent) => this.#finish(event);
    const cancel = (event: PointerEvent) => this.#finish(event, true);
    const lost = (event: PointerEvent) => { if (event.target === node) cancel(event); };
    const click = (event: MouseEvent) => {
      if (!this.#suppressClick) return;
      this.#suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    node.addEventListener('lostpointercapture', lost);
    node.addEventListener('click', click, true);
    return { destroy: () => {
      cancelAnimationFrame(this.#scrolling);
      clearTimeout(this.#clickTimer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      node.removeEventListener('lostpointercapture', lost);
      node.removeEventListener('click', click, true);
      if (this.#root === node) this.#root = null;
    } };
  };

  /** A press on an item's handle. */
  start(event: PointerEvent, id: string) {
    if (!this.enabled || event.button !== 0 || !event.isPrimary || this.saving) return;
    if (event.pointerType === 'touch' && !(event.target as Element).closest(this.#options.grip)) return;
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    this.#pointer = event.pointerId;
    this.#candidate = id;
    this.#original = [...this.#shown];
    this.#pressedAt = { x: event.clientX, y: event.clientY };
  }

  #move(event: PointerEvent) {
    if (event.pointerId !== this.#pointer || !this.#candidate || !this.#root) return;
    if (!this.dragging) {
      if (Math.hypot(event.clientX - this.#pressedAt.x, event.clientY - this.#pressedAt.y) < 6) return;
      // Capture only an actual drag, keeping a click or tap available for what the handle does.
      this.#root.setPointerCapture(event.pointerId);
      this.dragging = this.#candidate;
      this.draft = [...this.#original];
      this.#suppressClick = true;
      this.#scrolling = requestAnimationFrame(this.#scroll);
    }
    event.preventDefault();
    this.#lastPoint = { x: event.clientX, y: event.clientY };
    this.#place(event.clientX, event.clientY);
  }

  #place(x: number, y: number) {
    if (!this.dragging || !this.draft || !this.#root) return;
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>(this.#options.item);
    const id = target?.dataset[this.#options.attribute ?? 'accountId'];
    if (!target || !id || !this.#root.contains(target) || id === this.dragging) return;
    const ids = this.draft.filter((entry) => entry !== this.dragging);
    const index = ids.indexOf(id);
    if (index < 0) return;
    const box = target.getBoundingClientRect();
    ids.splice(index + (y > box.top + box.height / 2 ? 1 : 0), 0, this.dragging);
    this.draft = ids;
  }

  #finish(event: PointerEvent, cancel = false) {
    if (event.pointerId !== this.#pointer) return;
    cancelAnimationFrame(this.#scrolling);
    const ids = this.draft;
    this.#pointer = null;
    this.#candidate = null;
    this.dragging = null;
    clearTimeout(this.#clickTimer);
    this.#clickTimer = window.setTimeout(() => { this.#suppressClick = false; }, 0);
    if (!cancel && ids && ids.some((id, index) => id !== this.#original[index])) void this.#save(ids);
    else this.draft = null;
  }

  /** Arrow keys, Home and End on a focused handle. */
  keyboard(event: KeyboardEvent, id: string) {
    if (!this.enabled) return;
    const ids = [...this.#shown];
    const from = ids.indexOf(id);
    const to = event.key === 'ArrowUp' ? from - 1 : event.key === 'ArrowDown' ? from + 1 :
      event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1;
    if (to < 0 || to >= ids.length || this.saving) return;
    event.preventDefault();
    event.stopPropagation();
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    this.draft = ids;
    void this.#save(ids);
  }
}
