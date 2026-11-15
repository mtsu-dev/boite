/**
 * The rows a list's foot measures against (MobileNavigation.svelte): a thread on either, a project
 * head, a draft, the fold action, Reconnect, and anything else that marks itself `data-row-edge`.
 */
const ROW_EDGES = '[data-testid=thread-row], [data-testid=mobile-row], [data-testid=project-row], [data-row-edge], [data-testid=draft-row], [data-testid=project-more], [data-testid=project-reconnect]';
/** The heads that open a card (the phone's project heading, the desktop's project head), and their cards. */
const CARD_HEADS = '[data-row-edge], [data-testid=project-row]';
const CARDS = '[data-testid=mobile-project-group], [data-testid=project]';
/** A row that is a card of its own (Activity's), and the title its line marks. */
const ROW_CARDS = '[data-row-card]';
const ROW_TITLE = '[data-row-title] .title, [data-row-title]';

/** A row's box; a card's (`title`) also says where its title ends. */
export type CutRow = { top: number; bottom: number; title?: number };

/**
 * How far above a scroll box's foot its fade must end so the box never shows half a row at rest: from the bottom
 * edge to the top of the first row that edge slices, less the fade, so the fade runs over that row's top padding and
 * its text is gone. Zero when the edge falls between rows or only through a row's bottom padding (`slack`), and for
 * a row taller than a third of the box, which the plain fade serves better than a hole.
 * A card (a card's head, or a row that is a card) reads as one while its title ends above the fade: it stays, the
 * fade over its foot. Short of that it goes whole from its top, the fade included: a strip of a card's ground with
 * no title on it reads as a cut card, not as more below.
 * `rows` are in the list's order, which is top to bottom.
 */
export function rowCut(edge: number, height: number, rows: Iterable<CutRow>, fade: number, slack = 4): number {
  for (const row of rows) {
    if (row.top >= edge) return 0;
    let cut: number;
    if (row.title !== undefined) {
      if (row.title <= edge - fade) continue;
      cut = edge - row.top;
    } else {
      if (row.bottom <= edge + slack) continue;
      cut = row.top >= edge - fade ? 0 : edge - row.top - fade;
    }
    return cut <= height / 3 ? Math.round(cut) : 0;
  }
  return 0;
}

/**
 * Keeps `set` given the list's cut while it rests: measured once it settles (a resize, new rows, the end of a
 * scroll), zero while it scrolls, so a row passing the edge is never hidden mid-motion. The fade is the box's
 * `--fade`. Loaded lazily with the phone's list by MobileNavigation.svelte; returns the stop.
 */
export function watchRowCut(box: HTMLElement, set: (cut: number) => void): () => void {
  let settle: ReturnType<typeof setTimeout> | undefined;
  const measure = () => {
    const { bottom, height } = box.getBoundingClientRect();
    const fade = parseFloat(getComputedStyle(box).getPropertyValue('--fade')) || 0;
    set(rowCut(bottom, height, [...box.querySelectorAll(ROW_EDGES)].map((row): CutRow => {
      const { top, bottom: end } = row.getBoundingClientRect();
      // A head's title is its own line, and its card goes from the card's top, its padding over the head included.
      const card = row.matches(CARD_HEADS) ? row.closest(CARDS) : null;
      if (card) return { top: card.getBoundingClientRect().top, bottom: end, title: end };
      const title = row.matches(ROW_CARDS) ? row.querySelector(ROW_TITLE) : null;
      return title ? { top, bottom: end, title: title.getBoundingClientRect().bottom } : { top, bottom: end };
    }), fade));
  };
  const rest = (delay: number) => { clearTimeout(settle); settle = setTimeout(measure, delay); };
  const scrolled = () => { set(0); rest(140); };
  const resized = new ResizeObserver(() => rest(60));
  const changed = new MutationObserver(() => rest(60));
  resized.observe(box);
  changed.observe(box, { childList: true, subtree: true });
  box.addEventListener('scroll', scrolled, { passive: true });
  rest(0);
  return () => { resized.disconnect(); changed.disconnect(); box.removeEventListener('scroll', scrolled); clearTimeout(settle); };
}
