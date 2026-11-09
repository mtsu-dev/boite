/**
 * The rows a list's foot measures against (RailFrame.svelte, MobileNavigation.svelte): a thread on either, a project
 * head, a draft, the fold action, Reconnect, and anything else that marks itself `data-row-edge`.
 */
const ROW_EDGES = '[data-testid=thread-row], [data-testid=mobile-row], [data-testid=project-row], [data-row-edge], [data-testid=draft-row], [data-testid=project-more], [data-testid=project-reconnect]';

/**
 * How far above a scroll box's foot its fade must end so the box never shows half a row at rest: from the bottom
 * edge to the top of the first row that edge slices, less the fade, so the fade runs over that row's top padding and
 * its text is gone. Zero when the edge falls between rows or only through a row's bottom padding (`slack`), and for
 * a row taller than a third of the box, which the plain fade serves better than a hole.
 * `rows` are in the list's order, which is top to bottom.
 */
export function rowCut(edge: number, height: number, rows: Iterable<{ top: number; bottom: number }>, fade: number, slack = 4): number {
  for (const row of rows) {
    if (row.bottom <= edge + slack) continue;
    if (row.top >= edge - fade) return 0;
    const cut = edge - row.top - fade;
    return cut <= height / 3 ? Math.round(cut) : 0;
  }
  return 0;
}

/**
 * Keeps `set` given the list's cut while it rests: measured once it settles (a resize, new rows, the end of a
 * scroll), zero while it scrolls, so a row passing the edge is never hidden mid-motion. The fade is the box's
 * `--fade`. Loaded lazily by RailFrame.svelte, with the phone's list by MobileNavigation.svelte; returns the stop.
 */
export function watchRowCut(box: HTMLElement, set: (cut: number) => void): () => void {
  let settle: ReturnType<typeof setTimeout> | undefined;
  const measure = () => {
    const { bottom, height } = box.getBoundingClientRect();
    const fade = parseFloat(getComputedStyle(box).getPropertyValue('--fade')) || 0;
    set(rowCut(bottom, height, [...box.querySelectorAll(ROW_EDGES)].map(row => row.getBoundingClientRect()), fade));
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
