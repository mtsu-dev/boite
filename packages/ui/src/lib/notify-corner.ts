import './notify-corner.css';

/**
 * One home for every notice: the undo and error toasts (`toastSlot`) and the
 * arriving cards (contact mail and requests, plugin updates, memory notes,
 * `class="notify-corner" use:notifyCorner`), all one form (Notice.svelte,
 * floating). With a thread or a phone list on screen they sit in room
 * the page keeps at its bottom, right above the composer or the tab bar,
 * centred on it, so none covers a line, a title or the field being typed in.
 * With neither, a desktop keeps the bottom-right corner, the cards stacked
 * upward in arrival order above the toasts and lifted over what owns the
 * bottom edge under them. The lift is `--corner-lift` on each card.
 */
/** Bottom-edge owners. A composer centred in an empty thread is not one. */
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
 * The toasts' home, in room the page keeps for them so they cover no line,
 * row or title: at the bottom of what scrolls, the thread or the phone's list
 * over it, right above the composer (its strip included) or the tab bar,
 * centred on it, where the eye and the hand that made the change are. The
 * timeline gives way at its bottom on every width. A desktop page with no
 * timeline keeps the bottom-right corner.
 *
 * The arriving cards take that room too, under the toasts, on every width: a
 * card never sits over a line of the conversation or a row of the list.
 * Returns the cards it placed.
 */
function placeToasts(): HTMLElement[] {
  const up = toasts.filter((toast) => toast.offsetHeight > 0);
  const phone = innerWidth <= 720;
  // On a phone the list screen lies over the thread, which still lays out under it.
  const over = (phone && shown('[data-testid=mobile-list]')) || shown('[data-testid=timeline]');
  // Last first: the first card to arrive sits lowest, as in the corner.
  const slotted = over ? cards.filter((card) => card.offsetHeight > 0).reverse() : [];
  const room = [...up, ...slotted].reduce((sum, node) => sum + node.offsetHeight + 8, 0);
  reserve(over, room > 0 ? room + 8 : 0);
  let top: number, centre: number | null;
  if (over) {
    const box = over.getBoundingClientRect();
    // The scroller's own bottom, before the room it keeps (its margin, even mid-transition).
    top = box.bottom + (parseFloat(getComputedStyle(over).marginBottom) || 0) - room;
    centre = box.left + box.width / 2;
  } else {
    top = innerHeight - 12 - room + 8;
    centre = null;
  }
  for (const toast of up) {
    toast.style.setProperty('--toast-top', `${Math.round(top)}px`);
    if (centre === null) toast.style.removeProperty('--toast-left');
    else toast.style.setProperty('--toast-left', `${Math.round(centre)}px`);
    toast.dataset.slot = centre === null ? 'end' : 'bottom';
    top += toast.offsetHeight + 8;
  }
  // A card's place is its lift from the window's bottom edge (notify-corner.css adds 12).
  for (const card of slotted) {
    card.style.setProperty('--corner-lift', `${Math.round(innerHeight - 12 - top - card.offsetHeight)}px`);
    if (centre !== null) card.style.setProperty('--toast-left', `${Math.round(centre)}px`);
    card.dataset.slot = 'bottom';
    top += card.offsetHeight + 8;
  }
  return slotted;
}

function placeCards(slotted: HTMLElement[]): void {
  let lift = -1;
  const bar = shown('[data-testid=composer-strip]')?.getBoundingClientRect();
  for (const card of cards) {
    // A card hidden on this page (display: none) keeps no room; one in the toasts' room is placed.
    if (!card.offsetHeight || slotted.includes(card)) continue;
    delete card.dataset.slot;
    card.style.removeProperty('--toast-left');
    if (lift < 0) {
      const { left, right } = card.getBoundingClientRect();
      lift = 0;
      for (const owner of document.querySelectorAll(FLOORS)) {
        const box = owner.getBoundingClientRect();
        if (box.height && box.right > left && box.left < right && box.bottom > innerHeight - 160) lift = Math.max(lift, innerHeight - box.top);
      }
      // The strip above the composer (subagents, the way back) sits on that floor: a card rises over it too.
      if (lift > 0 && bar?.height && bar.right > left && bar.left < right && bar.bottom >= innerHeight - lift - 1) lift = Math.max(lift, innerHeight - bar.top);
      // Toasts in the corner (no timeline to keep room in) sit at its bottom: the cards stack above them.
      lift = Math.max(lift, toasts.reduce((sum, toast) => sum + (toast.offsetHeight > 0 && toast.dataset.slot === 'end' ? toast.offsetHeight + 8 : 0), 0));
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
// while a card is up keeps the places true without hooking them.
function track(list: HTMLElement[], node: HTMLElement): { destroy(): void } {
  if (list.push(node) + (list === cards ? toasts : cards).length === 1) timer = window.setInterval(place, 300);
  place();
  return {
    destroy() {
      list.splice(list.indexOf(node), 1);
      if (cards.length || toasts.length) place();
      else { clearInterval(timer); reserve(null, 0); }
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
