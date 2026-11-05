/**
 * Where the toasts sit: centred over the chat, 12 px above the composer's
 * dock, so they never cover the title bar, what the user types or the chips
 * stacked on the composer (the status strip, the queued messages, an open
 * task band). Without a composer in view, on a phone list, a toast takes the
 * tab bar's own place for its lifetime, so it covers no row the bar did not
 * already cover; the tabs come back when it goes. Else it sits 12 px above
 * the bottom of the main card. The action writes `--toast-x`,
 * `--toast-bottom`, `--toast-width` and `--toast-cover-height` on its node, sets
 * `html[data-toast-cover=tabs]` while a toast covers the tab bar, and follows
 * the layout while the node lives.
 */
const GAP = 12;

/** What stands on the composer and must stay readable under a toast. */
const DOCK = ['[data-testid="status-strip"]', '[data-testid="composer-queued"]', '[data-testid="question-queued"]', '[data-testid="thread-activity"]:not(.hidden)'];

export interface ToastSpot {
  x: number;
  bottom: number;
  /** Set when the toast takes the phone tab bar's place: the bar's size, so the toast fills its capsule. */
  cover?: { width: number; height: number };
}

function visible(element: Element | null): DOMRect | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? box : null;
}

/**
 * The box of an anchor the user can see: drawn (`checkVisibility`), inside
 * the viewport and not under `[inert]`. The phone list keeps the chat's
 * composer laid out beside it, with a real box, so a box alone is not enough.
 */
function shown(element: Element | null, width: number, height: number): DOMRect | null {
  const box = visible(element);
  if (!box || !element) return null;
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) return null;
  if (element.closest('[inert]')) return null;
  return box.left + box.width > 0 && box.left < width && box.top + box.height > 0 && box.top < height ? box : null;
}

/** The spot for a window of `height` px: the composer's dock first, then the tab bar's place, then the main card. */
export function toastSpot(root: ParentNode, width: number, height: number): ToastSpot {
  const composer = shown(root.querySelector('[data-testid="composer"]'), width, height);
  if (composer) {
    const top = DOCK.reduce((highest, selector) => {
      const box = visible(root.querySelector(selector));
      return box ? Math.min(highest, box.top) : highest;
    }, composer.top);
    return { x: composer.left + composer.width / 2, bottom: height - top + GAP };
  }
  const tabs = shown(root.querySelector('[data-testid="mobile-tabs"]'), width, height);
  if (tabs) return { x: tabs.left + tabs.width / 2, bottom: height - (tabs.top + tabs.height), cover: { width: tabs.width, height: tabs.height } };
  const card = visible(root.querySelector('.body .framed'));
  if (card) return { x: card.left + card.width / 2, bottom: height - card.bottom + GAP };
  return { x: width / 2, bottom: GAP };
}

export function toastAnchor(node: HTMLElement): { destroy(): void } {
  let frame = 0;
  const place = () => {
    frame = 0;
    const spot = toastSpot(document, window.innerWidth, window.innerHeight);
    node.style.setProperty('--toast-x', `${Math.round(spot.x)}px`);
    node.style.setProperty('--toast-bottom', `${Math.round(spot.bottom)}px`);
    if (spot.cover) {
      node.style.setProperty('--toast-width', `${Math.round(spot.cover.width)}px`);
      node.style.setProperty('--toast-cover-height', `${Math.round(spot.cover.height)}px`);
    } else {
      node.style.removeProperty('--toast-width');
      node.style.removeProperty('--toast-cover-height');
    }
    cover(spot.cover !== undefined && node.childElementCount > 0);
  };
  const cover = (on: boolean) => {
    if (on) document.documentElement.dataset.toastCover = 'tabs';
    else delete document.documentElement.dataset.toastCover;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
  // A toast lives a few seconds: the composer grows, a panel opens or the
  // page changes under it, so the spot follows the layout while one shows,
  // and nothing runs while none does.
  let timer: ReturnType<typeof setInterval> | null = null;
  const follow = () => {
    const showing = node.childElementCount > 0;
    if (showing && timer === null) timer = setInterval(schedule, 250);
    if (!showing && timer !== null) { clearInterval(timer); timer = null; }
    if (showing) place();
    else cover(false);
  };
  place();
  follow();
  const observer = new MutationObserver(follow);
  observer.observe(node, { childList: true });
  window.addEventListener('resize', schedule);
  return {
    destroy() {
      observer.disconnect();
      if (timer !== null) clearInterval(timer);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      cover(false);
    }
  };
}
