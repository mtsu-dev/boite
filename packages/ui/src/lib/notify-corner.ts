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
let roomed: HTMLElement | null = null;

/**
 * Room for the toasts at the bottom of `at` (`--corner-room`, drawn by
 * notify-corner.css), so the page under them gives way and nothing sits
 * under them.
 */
function reserve(at: HTMLElement | null, room: number): void {
  // Cleared then set in one task: an unchanged room is no style change.
  roomed?.style.removeProperty('--corner-room');
  delete roomed?.dataset.cornerRoom;
  roomed = room > 0 ? at : null;
  roomed?.style.setProperty('--corner-room', `${room}px`);
  if (roomed) roomed.dataset.cornerRoom = 'bottom';
}

function shown(selector: string): HTMLElement | null {
  const found = document.querySelector<HTMLElement>(selector);
  return found && found.getClientRects().length > 0 ? found : null;
}

/**
 * Phones reserve room at the bottom of their timeline or list. Desktops
 * stack toasts then cards down from the top-right corner. Returns the cards
 * it placed.
 */
function placeToasts(): HTMLElement[] {
  const up = toasts.filter((toast) => toast.offsetHeight > 0);
  const phone = innerWidth <= 720;
  // On a phone the list screen lies over the thread, which still lays out under it.
  const over = phone ? shown('[data-testid=mobile-list]') || shown('[data-testid=timeline]') : null;
  // Last first: on a phone the first card to arrive sits lowest; on a desktop the newest sits under the toasts.
  const slotted = over || !phone ? cards.filter((card) => card.offsetHeight > 0).reverse() : [];
  const room = [...up, ...slotted].reduce((sum, node) => sum + node.offsetHeight + 8, 0);
  reserve(over, room > 0 ? room + 8 : 0);
  let top: number, centre: number | null;
  if (over) {
    const box = over.getBoundingClientRect();
    // The scroller's own bottom, before the room it keeps (its margin, even mid-transition).
    top = box.bottom + (parseFloat(getComputedStyle(over).marginBottom) || 0) - room;
    centre = box.left + box.width / 2;
  } else {
    // Clear phone centring before measuring the corner after a resize.
    for (const node of [...up, ...cards]) {
      delete node.dataset.slot;
      node.style.removeProperty('--toast-left');
    }
    // A desktop corner starts 12 under the title bar, which holds the thread's header.
    top = phone ? innerHeight - 12 - room + 8 - cornerFloor() : (shown('[data-testid=titlebar]')?.getBoundingClientRect().bottom ?? 0) + 12;
    centre = null;
  }
  for (const toast of up) {
    toast.style.setProperty('--toast-top', `${Math.round(top)}px`);
    if (centre !== null) toast.style.setProperty('--toast-left', `${Math.round(centre)}px`);
    toast.dataset.slot = centre === null ? 'end' : 'bottom';
    top += toast.offsetHeight + 8;
  }
  // A card's place is its lift from the window's bottom edge (notify-corner.css adds 12).
  for (const card of slotted) {
    card.style.setProperty('--corner-lift', `${Math.round(innerHeight - 12 - top - card.offsetHeight)}px`);
    if (centre !== null) {
      card.style.setProperty('--toast-left', `${Math.round(centre)}px`);
      card.dataset.slot = 'bottom';
    }
    top += card.offsetHeight + 8;
  }
  return slotted;
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

function placeCards(slotted: HTMLElement[]): void {
  let lift = -1;
  for (const card of cards) {
    // A card hidden on this page (display: none) keeps no room; one in the toasts' room is placed.
    if (!card.offsetHeight || slotted.includes(card)) continue;
    if (lift < 0) {
      lift = cornerFloor();
      lift += toasts.reduce((sum, toast) => sum + (toast.offsetHeight > 0 && toast.dataset.slot === 'end' ? toast.offsetHeight + 8 : 0), 0);
    }
    card.style.setProperty('--corner-lift', `${lift}px`);
    lift += card.offsetHeight + 8;
  }
}

/**
 * While a thread's page is on its way (ThreadLoading.svelte) there is no timeline to keep room in, and a card in the
 * corner would sit over the composer the skeleton leads to: every card and toast waits, hidden, until the page has
 * landed, then takes its reserved slot. On a phone the list screen over a loading thread is its own page.
 */
function holding(): boolean {
  return !!shown('[data-testid=thread-loading]') && !(innerWidth <= 720 && shown('[data-testid=mobile-list]'));
}

function place(): void {
  const held = holding();
  for (const node of [...cards, ...toasts]) {
    if (held) node.dataset.held = '';
    else delete node.dataset.held;
  }
  if (held) { reserve(null, 0); return; }
  placeCards(placeToasts());
}

// The composer grows as one types and the strip comes and goes: a slow poll
// while a card is up keeps the places true without hooking them. A resize
// moves the page under them at once: a place in pixels for the old width
// would sit off screen until the next poll, so the window's resize re-places
// them before that frame is painted.
function track(list: HTMLElement[], node: HTMLElement): { destroy(): void } {
  if (list.push(node) + (list === cards ? toasts : cards).length === 1) {
    timer = window.setInterval(place, 300);
    window.addEventListener('resize', place);
  }
  place();
  return {
    destroy() {
      list.splice(list.indexOf(node), 1);
      if (cards.length || toasts.length) place();
      else { clearInterval(timer); window.removeEventListener('resize', place); reserve(null, 0); }
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
