import './notify-corner.css';

/**
 * The bottom-right corner every arriving card shares: contact mail and
 * requests, plugin updates, memory notes. A card takes it with
 * `class="notify-corner" use:notifyCorner`. Cards stack upward in arrival
 * order and rise over what owns the bottom edge under them (the composer and
 * the activity strip on it, the phone's tab bar), so none covers a title or
 * the field being typed in. The lift is `--corner-lift` on each card.
 *
 * The undo and error toasts have a home of their own instead, which nothing
 * else shares (`toastSlot`).
 */
/** Bottom-edge owners. A composer centred in an empty thread is not one. */
const FLOORS = '[data-testid=composer],[data-testid=thread-activity],[data-testid=mobile-tabs]';
/** The phone's headers, under which its toasts sit. */
const HEADERS = '[data-testid=mobile-header],[data-testid=thread-header],[data-testid=mobile-settings-header],[data-testid=agent-header],[data-testid=team-header]';
const PHONE = '(max-width: 720px)';
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
 * The toast home. On a phone it is under the header, centred, in room the
 * timeline keeps for it at its top. On a wider
 * window it is the right end of the strip above the composer, in room the
 * strip keeps for it at its top: the strip's entries, the composer and the
 * timeline's last lines all stay clear. A page with no composer keeps the
 * bottom-right corner.
 */
function placeToasts(): void {
  const shown = toasts.filter((toast) => toast.offsetHeight > 0);
  const room = shown.reduce((sum, toast) => sum + toast.offsetHeight + 8, 0);
  const phone = matchMedia(PHONE).matches;
  // A phone's toasts push the timeline's top down, so they cover no line of it.
  const over = phone ? document.querySelector<HTMLElement>('[data-testid=timeline]') : strip();
  reserve(over, room);
  let top: number, right: number | null;
  if (phone) {
    let under = 0;
    for (const header of document.querySelectorAll<HTMLElement>(HEADERS)) {
      const box = header.getBoundingClientRect();
      if (box.height && box.top < 120) under = Math.max(under, box.bottom);
    }
    top = under + 8;
    right = null;
  } else if (over) {
    const box = over.getBoundingClientRect();
    top = box.top + 4;
    right = Math.max(12, innerWidth - box.right);
  } else {
    top = innerHeight - 12 - room + 8;
    right = 16;
  }
  for (const toast of shown) {
    toast.style.setProperty('--toast-top', `${Math.round(top)}px`);
    if (right === null) toast.style.removeProperty('--toast-right');
    else toast.style.setProperty('--toast-right', `${Math.round(right)}px`);
    toast.dataset.slot = right === null ? 'header' : 'end';
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
      // The strip above the composer (subagents, the way back, the toasts' room) sits on that floor: a card rises over it too.
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
