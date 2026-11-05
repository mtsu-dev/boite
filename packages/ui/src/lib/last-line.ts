/**
 * A thread row's right cluster (pin, subagent count, time) ends the row's last
 * text line, in every list: Recent's subline already carries it, and a row
 * without one whose title wraps carries it on the title's second line, so the
 * ages of a group line up on each row's last line and the title's first line
 * runs the full width.
 *
 * The line holds `[data-last-line=title]`, its text ending in an empty inline
 * `[data-last-line=room]` padded to the cluster's width, and
 * `[data-last-line=cluster]`, which the row's CSS draws at the line's bottom
 * right. The room sticks to the title's last word, so the last line keeps the
 * cluster's width free. A title longer than its lines hides the room past its
 * ellipsis: the line then takes `data-fit="narrow"` and the CSS keeps the
 * cluster's width off every line instead. `data-drawn` says how many lines the
 * title takes.
 *
 * Every line is fitted by one shared observer, in two reads and two writes per
 * batch whatever the number of rows.
 */

const active = new Map<HTMLElement, HTMLElement>();
let observer: ResizeObserver | undefined;

function part(line: HTMLElement, name: 'title' | 'cluster'): HTMLElement | null {
  return line.querySelector<HTMLElement>(`[data-last-line=${name}]`);
}

/** The title shows less than its text: more lines than its clamp, or a one-line title cut by its ellipsis. */
export function overflows(title: Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollWidth' | 'clientWidth'>): boolean {
  return title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1;
}

/** Measures each line's cluster, gives its title that room on the last line, and narrows the lines whose title overflows. */
export function fitLines(lines: Iterable<HTMLElement>): void {
  const list = [...lines].filter((line) => line.isConnected && active.has(line));
  const widths = list.map((line) => part(line, 'cluster')?.offsetWidth ?? 0);
  list.forEach((line, n) => {
    line.style.setProperty('--room', `${widths[n]}px`);
    delete line.dataset.fit;
  });
  const fits = list.map((line) => {
    const title = part(line, 'title');
    if (!title) return { over: false, drawn: 1 };
    const height = Number.parseFloat(getComputedStyle(title).lineHeight);
    const drawn = height > 0 ? Math.max(1, Math.round(title.clientHeight / height)) : 1;
    return { over: overflows(title), drawn };
  });
  list.forEach((line, n) => {
    const { over, drawn } = fits[n]!;
    if (over) line.dataset.fit = 'narrow';
    line.dataset.drawn = String(drawn);
  });
}

const pending = new Set<HTMLElement>();
/** A renamed title refits once the row has drawn it, with every other line renamed in the same tick. */
function refit(line: HTMLElement): void {
  if (pending.size === 0) queueMicrotask(() => { const lines = [...pending]; pending.clear(); fitLines(lines); });
  pending.add(line);
}

function watch(line: HTMLElement): void {
  const cluster = part(line, 'cluster');
  active.set(line, cluster ?? line);
  if (typeof ResizeObserver === 'undefined') return;
  // The observer's first callback fits a line it starts watching.
  observer ??= new ResizeObserver((entries) => {
    const lines = new Set<HTMLElement>();
    for (const entry of entries) {
      const target = entry.target as HTMLElement;
      const line = active.has(target) ? target : target.closest<HTMLElement>('[data-last-line=line]');
      if (line) lines.add(line);
    }
    fitLines(lines);
  });
  observer.observe(line);
  if (cluster) observer.observe(cluster);
}

function unwatch(line: HTMLElement): void {
  const cluster = active.get(line);
  if (!active.delete(line)) return;
  pending.delete(line);
  observer?.unobserve(line);
  if (cluster && cluster !== line) observer?.unobserve(cluster);
  line.style.removeProperty('--room');
  delete line.dataset.fit;
  delete line.dataset.drawn;
}

/**
 * `use:lastLine={key}`: on while `key` is set (the title, so a rename refits
 * the line), off for `null`, a row whose cluster stays in the title's flow.
 */
export function lastLine(line: HTMLElement, key: string | null) {
  line.dataset.lastLine = 'line';
  let last: string | null = null;
  const set = (next: string | null) => {
    if (next === null) unwatch(line);
    else if (!active.has(line)) watch(line);
    else if (next !== last) refit(line);
    last = next;
  };
  set(key);
  return { update: set, destroy: () => unwatch(line) };
}
