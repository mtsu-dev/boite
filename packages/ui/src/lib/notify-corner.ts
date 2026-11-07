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
let timer = 0;

function place(): void {
  let lift = -1;
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
    }
    card.style.setProperty('--corner-lift', `${lift}px`);
    lift += card.offsetHeight + 8;
  }
}

export function notifyCorner(node: HTMLElement): { destroy(): void } {
  // The composer grows as one types and the strip comes and goes: a slow
  // poll while a card is up keeps the lift true without hooking them.
  if (cards.push(node) === 1) timer = window.setInterval(place, 300);
  place();
  return {
    destroy() {
      cards.splice(cards.indexOf(node), 1);
      if (cards.length) place();
      else clearInterval(timer);
    }
  };
}
