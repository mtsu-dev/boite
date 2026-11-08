import './notify-corner.css';

/**
 * The bottom-right corner every arriving card shares: contact mail and
 * requests, plugin updates, memory notes. A card takes it with
 * `class="notify-corner" use:notifyCorner`. Cards stack upward in arrival
 * order and rise over what owns the bottom edge under them (the composer and
 * the activity strip on it, the phone's tab bar), so none covers a title or
 * the field being typed in. The lift is `--corner-lift` on each card.
 *
 * The undo and error toasts have a home of their own instead, at the top of
 * the thread, which nothing else shares (`toastSlot`).
 */
/** Bottom-edge owners. A composer centred in an empty thread is not one. */
const FLOORS = '[data-testid=composer],[data-testid=thread-activity],[data-testid=mobile-tabs]';
/** The headers the toasts sit under. */
const HEADERS = '[data-testid=mobile-header],[data-testid=thread-header],[data-testid=mobile-settings-header],[data-testid=agent-header],[data-testid=team-header]';
const cards: HTMLElement[] = [];
const toasts: HTMLElement[] = [];
let timer = 0;
let roomed: HTMLElement | null = null;

function strip(): HTMLElement | null {
  const found = document.querySelector<HTMLElement>('[data-testid=composer-strip]');
  return found && found.getClientRects().length > 0 ? found : null;
}

/** Room at the top of `at` for the toasts (`--corner-room`), so the timeline gives way and nothing sits under them. */
function reserve(at: HTMLElement | null, room: number): void {
  // Cleared then set in one task: an unchanged room is no style change.
  roomed?.style.removeProperty('--corner-room');
  roomed = room > 0 ? at : null;
  roomed?.style.setProperty('--corner-room', `${room}px`);
}

/**
 * The toast home, the same at every width: under the header, centred on the
 * thread, in room the timeline keeps for it at its top. The timeline gives
 * way, so the toast covers no line of it, and the bottom stack (the strip's
 * subagents, the queue, the composer) stays clear of it. A page with no
 * timeline keeps the bottom-right corner.
 */
function placeToasts(): void {
  const shown = toasts.filter((toast) => toast.offsetHeight > 0);
  const room = shown.reduce((sum, toast) => sum + toast.offsetHeight + 8, 0);
  const found = document.querySelector<HTMLElement>('[data-testid=timeline]');
  const over = found && found.getClientRects().length > 0 ? found : null;
  reserve(over, room);
  let top: number, centre: number | null;
  if (over) {
    const box = over.getBoundingClientRect();
    let under = 0;
    for (const header of document.querySelectorAll<HTMLElement>(HEADERS)) {
      const head = header.getBoundingClientRect();
      if (head.height && head.top < 120 && head.right > box.left && head.left < box.right) under = Math.max(under, head.bottom);
    }
    // The timeline's own top, less the room it keeps (its margin, even mid-transition).
    const rest = box.top - (parseFloat(getComputedStyle(over).marginTop) || 0);
    top = Math.max(under, rest) + 8;
    centre = box.left + box.width / 2;
  } else {
    top = innerHeight - 12 - room + 8;
    centre = null;
  }
  for (const toast of shown) {
    toast.style.setProperty('--toast-top', `${Math.round(top)}px`);
    if (centre === null) toast.style.removeProperty('--toast-left');
    else toast.style.setProperty('--toast-left', `${Math.round(centre)}px`);
    toast.dataset.slot = centre === null ? 'end' : 'top';
    top += toast.offsetHeight + 8;
  }
}

function placeCards(): void {
  let lift = -1;
  const bar = strip()?.getBoundingClientRect();
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
