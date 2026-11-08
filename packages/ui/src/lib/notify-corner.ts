import './notify-corner.css';

/**
 * The bottom-right corner every arriving card shares: contact mail and
 * requests, plugin updates, memory notes. A card takes it with
 * `class="notify-corner" use:notifyCorner`. Cards stack upward in arrival
 * order and rise over what owns the bottom edge under them (the composer and
 * the activity strip on it, the phone's tab bar), so none covers a title or
 * the field being typed in. The lift is `--corner-lift` on each card.
 *
 * The undo and error toasts have a home of their own instead, in room the
 * page keeps for them, which nothing else shares (`toastSlot`).
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
 */
function placeToasts(): void {
  const up = toasts.filter((toast) => toast.offsetHeight > 0);
  const room = up.reduce((sum, toast) => sum + toast.offsetHeight + 8, 0);
  const phone = innerWidth <= 720;
  // On a phone the list screen lies over the thread, which still lays out under it.
  const over = (phone && shown('[data-testid=mobile-list]')) || shown('[data-testid=timeline]');
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
}

function placeCards(): void {
  let lift = -1;
  const bar = shown('[data-testid=composer-strip]')?.getBoundingClientRect();
  for (const card of cards) {
    // A card hidden on this page (display: none) keeps no room.
    if (!card.offsetHeight) continue;
    if (lift < 0) {
      const { left, right } = card.getBoundingClientRect();
      lift = 0;
      for (const owner of document.querySelectorAll(FLOORS)) {
        const box = owner.getBoundingClientRect();
        if (box.height && box.right > left && box.left < right && box.bottom > innerHeight - 160) lift = Math.max(lift, innerHeight - box.top);
      }
      // The strip above the composer (subagents, the way back) sits on that floor: a card rises over it too.
      if (lift > 0 && bar?.height && bar.right > left && bar.left < right && bar.bottom >= innerHeight - lift - 1) lift = Math.max(lift, innerHeight - bar.top);
    }
    card.style.setProperty('--corner-lift', `${lift}px`);
    lift += card.offsetHeight + 8;
  }
}

function place(): void {
  placeToasts();
  placeCards();
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
