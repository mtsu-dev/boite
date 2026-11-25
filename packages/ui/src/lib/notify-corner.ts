import './notify-corner.css';

/**
 * One home for every notice: the undo and error toasts (`toastSlot`) and the
 * arriving cards (contact mail and requests, plugin updates, memory notes,
 * `class="notify-corner" use:notifyCorner`), all one form (Notice.svelte,
 * floating). Phones keep room above the composer or tab bar. Desktops use
 * the top-right corner under the title bar without moving the conversation:
 * toasts first, the newest card under them.
 */
/** Bottom-edge owners on a phone. A composer centred in an empty thread is not one. */
const FLOORS = '[data-testid=composer],[data-testid=thread-activity],[data-testid=mobile-tabs]';
const cards: HTMLElement[] = [];
const toasts: HTMLElement[] = [];
let timer = 0;
let pollFrame = 0;
let roomed: HTMLElement | null = null;

function setProp(node: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    if (node.style.getPropertyValue(name) !== '') node.style.removeProperty(name);
  } else if (node.style.getPropertyValue(name) !== value) {
    node.style.setProperty(name, value);
  }
}

function setData(node: HTMLElement, key: string, value: string | undefined): void {
  if (value === undefined) {
    if (node.dataset[key] !== undefined) delete node.dataset[key];
  } else if (node.dataset[key] !== value) {
    node.dataset[key] = value;
  }
}

/**
 * Room for the toasts at the bottom of `at` (`--corner-room`, drawn by
 * notify-corner.css), so the page under them gives way and nothing sits
 * under them.
 */
function reserve(at: HTMLElement | null, room: number): void {
  const next = room > 0 ? at : null;
  if (roomed && roomed !== next) {
    setProp(roomed, '--corner-room', null);
    setData(roomed, 'cornerRoom', undefined);
  }
  roomed = next;
  if (roomed) {
    setProp(roomed, '--corner-room', `${room}px`);
    setData(roomed, 'cornerRoom', 'bottom');
  }
}

function shown(selector: string): HTMLElement | null {
  const found = document.querySelector<HTMLElement>(selector);
  return found && found.getClientRects().length > 0 ? found : null;
}

/** Height of controls beneath a phone's corner, shared by its toasts and cards; they span its width. */
function cornerFloor(): number {
  let lift = 0;
  for (const owner of document.querySelectorAll(FLOORS)) {
    const box = owner.getBoundingClientRect();
    // The wrapper includes the strip, queued messages and permissions above the field.
    if (box.height && box.bottom > innerHeight - 160) lift = Math.max(lift, innerHeight - (owner.closest('.composer-wrap')?.getBoundingClientRect().top ?? box.top));
  }
  return lift;
}

/**
 * While a thread's page is on its way (ThreadLoading.svelte) there is no timeline to keep room in, and a card in the
 * corner would sit over the composer the skeleton leads to: every card and toast waits, hidden, until the page has
 * landed, then takes its reserved slot. On a phone the list screen over a loading thread is its own page.
 */
function holding(phone: boolean): boolean {
  return !!shown('[data-testid=thread-loading]') && !(phone && shown('[data-testid=mobile-list]'));
}

/**
 * Phones reserve room at the bottom of the screen in front. Desktops stack
 * toasts then cards down from the top-right corner. Reads every box before
 * writing any style so an unchanged frame forces no layout.
 */
function place(): void {
  const phone = innerWidth <= 720;
  const held = holding(phone);
  if (held) {
    for (const node of cards) setData(node, 'held', '');
    for (const node of toasts) setData(node, 'held', '');
    reserve(null, 0);
    return;
  }

  // Pass 1 (READ ONLY): collect heights and anchor geometry before any DOM write.
  const heights = new Map<HTMLElement, number>();
  for (const node of toasts) heights.set(node, node.offsetHeight);
  for (const node of cards) heights.set(node, node.offsetHeight);

  const up = toasts.filter((toast) => (heights.get(toast) ?? 0) > 0);
  // Phone Settings covers the thread and tabs as a full-screen layer: never anchor to the covered timeline or composer.
  const settingsOver = phone && !!shown('.settings-layer.over');
  // The list and the panel cover the thread, whose timeline still lays out under them.
  const over = phone && !settingsOver
    ? shown('[data-testid=mobile-list]') ?? shown('[data-corner-anchor=panel]') ?? shown('[data-testid=timeline]')
    : null;
  // Last first: on a phone the first card to arrive sits lowest; on a desktop the newest sits under the toasts.
  const slotted = over || !phone ? cards.filter((card) => (heights.get(card) ?? 0) > 0).reverse() : [];
  const slottedSet = new Set(slotted);
  const unslotted = cards.filter((card) => (heights.get(card) ?? 0) > 0 && !slottedSet.has(card));

  const stacked = [...up, ...slotted];
  const stackedSet = new Set(stacked);
  const room = stacked.reduce((sum, node) => sum + (heights.get(node) ?? 0) + 8, 0);

  let top: number;
  let centre: number | null;
  let floor = 0;
  if (over) {
    const box = over.getBoundingClientRect();
    // The scroller's own bottom, before the room it keeps (its margin, even mid-transition).
    top = box.bottom + (parseFloat(getComputedStyle(over).marginBottom) || 0) - room;
    centre = box.left + box.width / 2;
  } else {
    if (phone) {
      floor = settingsOver ? 0 : cornerFloor();
      top = innerHeight - 12 - room + 8 - floor;
    } else {
      // A desktop corner starts 12 under the title bar, which holds the thread's header.
      top = (shown('[data-testid=titlebar]')?.getBoundingClientRect().bottom ?? 0) + 12;
    }
    centre = null;
  }

  let lift = 0;
  if (unslotted.length > 0) {
    lift = phone && !over ? floor : settingsOver ? 0 : cornerFloor();
    if (centre === null) {
      lift += up.reduce((sum, toast) => sum + (heights.get(toast) ?? 0) + 8, 0);
    }
  }

  // Pass 2 (WRITE ONLY): mutate styles and attributes only when values change.
  for (const node of cards) setData(node, 'held', undefined);
  for (const node of toasts) setData(node, 'held', undefined);
  reserve(over, room > 0 ? room + 8 : 0);

  for (const node of [...toasts, ...cards]) {
    if (stackedSet.has(node)) continue;
    setData(node, 'slot', undefined);
    setProp(node, '--toast-left', null);
    setProp(node, '--toast-top', null);
  }

  // Toasts then cards, each by its top: one whose text lands after this grows down into its room, never up.
  const leftValue = centre !== null ? `${Math.round(centre)}px` : null;
  const slotValue = centre === null ? 'end' : 'bottom';
  for (const node of stacked) {
    setProp(node, '--toast-top', `${Math.round(top)}px`);
    setProp(node, '--corner-lift', null);
    setProp(node, '--toast-left', leftValue);
    setData(node, 'slot', slotValue);
    top += (heights.get(node) ?? 0) + 8;
  }

  for (const card of unslotted) {
    setProp(card, '--corner-lift', `${lift}px`);
    lift += (heights.get(card) ?? 0) + 8;
  }
}

let lastScroll = 0;
const noteScroll = (): void => { lastScroll = performance.now(); };

function poll(): void {
  if (document.hidden || document.querySelector('[data-slide]')) return;
  if (performance.now() - lastScroll < 250) return;
  if (pollFrame) return;
  if (typeof requestAnimationFrame === 'function') {
    pollFrame = requestAnimationFrame(() => {
      pollFrame = 0;
      if (performance.now() - lastScroll < 250) return;
      place();
    });
  } else {
    place();
  }
}

// The composer grows as one types and the strip comes and goes: a slow poll
// while a card is up keeps the places true without hooking them. A resize
// moves the page under them at once: a place in pixels for the old width
// would sit off screen until the next poll, so the window's resize re-places
// them before that frame is painted.
function track(list: HTMLElement[], node: HTMLElement): { destroy(): void } {
  if (list.push(node) + (list === cards ? toasts : cards).length === 1) {
    timer = window.setInterval(poll, 300);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', noteScroll, { capture: true, passive: true });
  }
  place();
  return {
    destroy() {
      const at = list.indexOf(node);
      if (at >= 0) list.splice(at, 1);
      if (cards.length || toasts.length) place();
      else {
        clearInterval(timer);
        if (pollFrame) { cancelAnimationFrame(pollFrame); pollFrame = 0; }
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', noteScroll, true);
        reserve(null, 0);
      }
    }
  };
}

export function notifyCorner(node: HTMLElement): { destroy(): void } {
  return track(cards, node);
}

/** The undo and error toasts' one home; pair with `class="toast-slot"`. */
export function toastSlot(node: HTMLElement): { destroy(): void } {
  return track(toasts, node);
}
