import './notify-corner.css';

/**
 * The bottom-right corner every arriving card shares: the error toast,
 * contact mail and requests, plugin updates. A card takes it with
 * `class="notify-corner" use:notifyCorner`. Cards stack upward in arrival
 * order and rise over what owns the bottom edge under them (the composer and
 * the activity strip on it, the phone's tab bar), so none covers a title or
 * the field being typed in. The lift is `--corner-lift` on each card.
 */
/** Bottom-edge owners. A composer centred in an empty thread is not one. */
const FLOORS = '[data-testid=composer],[data-testid=thread-activity],[data-testid=mobile-tabs]';
const cards: HTMLElement[] = [];
/** Cards that keep room of their own over the strip instead of covering the timeline. */
const reserving = new Set<HTMLElement>();
let timer = 0;
let roomed: HTMLElement | null = null;

/**
 * A reserving card (the undo toast) over the thread's column takes room at the
 * top of the strip (`--corner-room`), so the timeline gives way and nothing it
 * shows sits under the card. Beside the column, on a wide window, it is a
 * plain card.
 */
function reserve(strip: HTMLElement | null): number {
  let room = 0;
  const box = strip?.getBoundingClientRect();
  for (const card of reserving) {
    if (!card.offsetHeight || !box?.height) continue;
    if (box.right > card.getBoundingClientRect().left) room += card.offsetHeight + 8;
  }
  if (roomed && roomed !== strip) roomed.style.removeProperty('--corner-room');
  roomed = room > 0 ? strip : null;
  if (strip && room > 0) strip.style.setProperty('--corner-room', `${room}px`);
  else strip?.style.removeProperty('--corner-room');
  return room;
}

function place(): void {
  const strip = document.querySelector<HTMLElement>('[data-testid=composer-strip]');
  const room = reserve(strip);
  // The reserving cards lie lowest, in the room they keep; the others rise over them.
  const order = room > 0 ? [...cards.filter((card) => reserving.has(card)), ...cards.filter((card) => !reserving.has(card))] : cards;
  let lift = -1;
  for (const card of order) {
    // A card hidden on this page (display: none) keeps no room.
    if (!card.offsetHeight) continue;
    if (lift < 0) {
      const { left, right } = card.getBoundingClientRect();
      lift = 0;
      for (const owner of document.querySelectorAll(FLOORS)) {
        const box = owner.getBoundingClientRect();
        if (box.height && box.right > left && box.left < right && box.bottom > innerHeight - 160) lift = Math.max(lift, innerHeight - box.top);
      }
      // The strip above the composer (subagents, the way back) sits on that
      // floor: a card rises over it too, never onto its last button, or into
      // the room it keeps at its top (the 12 px is the corner's own margin).
      const box = strip?.getBoundingClientRect();
      if (lift > 0 && box?.height && box.right > left && box.left < right && box.bottom >= innerHeight - lift - 1) lift = Math.max(lift, room > 0 ? innerHeight - (box.top + room - 4) - 12 : innerHeight - box.top);
    }
    card.style.setProperty('--corner-lift', `${lift}px`);
    lift += card.offsetHeight + 8;
  }
}

export function notifyCorner(node: HTMLElement, options?: { reserve?: boolean }): { destroy(): void } {
  // The composer grows as one types and the strip comes and goes: a slow
  // poll while a card is up keeps the lift true without hooking them.
  if (options?.reserve) reserving.add(node);
  if (cards.push(node) === 1) timer = window.setInterval(place, 300);
  place();
  return {
    destroy() {
      cards.splice(cards.indexOf(node), 1);
      reserving.delete(node);
      if (cards.length) place();
      else { clearInterval(timer); reserve(document.querySelector<HTMLElement>('[data-testid=composer-strip]')); }
    }
  };
}
