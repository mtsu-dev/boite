/**
 * Where the toasts sit: centred over the chat, 12 px above the composer's
 * dock, so they never cover the title bar, what the user types or the chips
 * stacked on the composer (the status strip, the queued messages, an open
 * task band). Without a composer they sit above the phone's tab bar, else
 * 12 px above the bottom of the main card. The action writes `--toast-x` and
 * `--toast-bottom` on its node and follows the layout while the node lives.
 */
const GAP = 12;

/** What stands on the composer and must stay readable under a toast. */
const DOCK = ['[data-testid="status-strip"]', '[data-testid="composer-queued"]', '[data-testid="question-queued"]', '[data-testid="thread-activity"]:not(.hidden)'];

export interface ToastSpot {
  x: number;
  bottom: number;
}

function visible(element: Element | null): DOMRect | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? box : null;
}

/** The spot for a window of `height` px: the composer's dock first, then the tab bar, then the main card. */
export function toastSpot(root: ParentNode, width: number, height: number): ToastSpot {
  const composer = visible(root.querySelector('[data-testid="composer"]'));
  if (composer) {
    const top = DOCK.reduce((highest, selector) => {
      const box = visible(root.querySelector(selector));
      return box ? Math.min(highest, box.top) : highest;
    }, composer.top);
    return { x: composer.left + composer.width / 2, bottom: height - top + GAP };
  }
  const tabs = visible(root.querySelector('[data-testid="mobile-tabs"]'));
  if (tabs) return { x: width / 2, bottom: height - tabs.top + GAP };
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
    }
  };
}
