/** The least of the tile at a sideways strip's end that may show before its trailing fade. */
export const PEEK_MIN = 0.4;
/** The most: past it the tile reads whole and the next one shows only inside the fade, a sliver. */
export const PEEK_MAX = 0.8;
/** What shows of it once the strip is resized for it. */
export const PEEK_SHARE = 0.5;

/**
 * How many pixels every tile of a sideways strip grows by so the tile at its
 * end shows by `PEEK_SHARE`, or 0 when it already shows by `PEEK_MIN` to
 * `PEEK_MAX` (or every tile fits). `tiles` are the tiles' left edges and widths
 * at their natural size, `edge` where the strip's trailing fade starts. A tile
 * shown less is a sliver: the last whole tile becomes the one half shown, the
 * tiles before it growing evenly, so none gets narrower than its name needs. A
 * tile shown more is all but whole: it becomes the one half shown.
 */
export function peekGrow(edge: number, tiles: readonly { left: number; width: number }[]): number {
  const cut = tiles.findIndex((tile) => tile.left + tile.width > edge);
  if (cut < 0) return 0;
  const crossing = tiles[cut]!;
  const share = (edge - crossing.left) / crossing.width;
  if (share >= PEEK_MIN && share <= PEEK_MAX) return 0;
  // A sliver's whole neighbour peeks instead, an all but whole tile itself; the tiles before it each push it right by the growth.
  const at = share > PEEK_MAX ? cut : Math.max(0, cut - 1);
  const tile = tiles[at]!;
  return Math.max(0, (edge - tile.left - PEEK_SHARE * tile.width) / (at + PEEK_SHARE));
}

/**
 * A vertical rail of tiles that shows only whole ones: its height stops at the
 * last tile that fits in its grid cell, with room left under it for a cue, and
 * `data-more` says a tile waits below. A tile cut in half reads as a logo
 * without its name, so none is shown cut. Under `wideOnly`'s width the rail
 * is a phone's sideways strip: when its end would cut a tile to a sliver or
 * fall between two, every tile grows by `--tile-grow` so one shows by half.
 */
export function wholeTiles(rail: HTMLElement, options: { cell: () => number; cue: number; tiles: string; wideOnly: string }) {
  const wide = window.matchMedia(options.wideOnly);
  function more() {
    if (rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1) rail.dataset.more = 'true';
    else delete rail.dataset.more;
  }
  /** The phone strip: natural widths unless its end cuts a tile to a sliver or hides the next one whole. */
  function peek() {
    rail.style.removeProperty('--tile-grow');
    const tiles = [...rail.querySelectorAll<HTMLElement>(options.tiles)];
    const last = tiles.at(-1);
    if (!last) return;
    // The end padding is as wide as the trailing fade: what shows of a tile is what sits left of it.
    const fade = rail.clientWidth - (parseFloat(getComputedStyle(rail).paddingRight) || 0);
    // The rail is positioned, so offsetLeft counts from its own edge; a strip that holds every tile is left alone.
    if (last.offsetLeft + last.offsetWidth <= fade) return;
    const grow = peekGrow(fade, tiles.map((tile) => ({ left: tile.offsetLeft, width: tile.offsetWidth })));
    if (grow > 0) rail.style.setProperty('--tile-grow', `${grow.toFixed(2)}px`);
  }
  function fit() {
    if (!wide.matches) {
      rail.style.height = '';
      delete rail.dataset.more;
      peek();
      return;
    }
    rail.style.removeProperty('--tile-grow');
    const room = options.cell();
    const pad = parseFloat(getComputedStyle(rail).paddingBottom) || 0;
    // offsetTop and offsetHeight are layout values: the menu's opening scale does not skew them.
    const bottoms = [...rail.querySelectorAll<HTMLElement>(options.tiles)].map((tile) => tile.offsetTop + tile.offsetHeight);
    const last = bottoms.at(-1) ?? 0;
    if (!room || last + pad <= room) rail.style.height = '';
    else {
      const whole = bottoms.filter((bottom) => bottom + pad + options.cue <= room);
      rail.style.height = `${(whole.at(-1) ?? bottoms[0] ?? 0) + pad}px`;
    }
    more();
  }
  const observer = new ResizeObserver(fit);
  observer.observe(rail);
  if (rail.parentElement) observer.observe(rail.parentElement);
  const children = new MutationObserver(fit);
  children.observe(rail, { childList: true, subtree: true });
  rail.addEventListener('scroll', more, { passive: true });
  wide.addEventListener('change', fit);
  fit();
  return {
    destroy() {
      observer.disconnect();
      children.disconnect();
      rail.removeEventListener('scroll', more);
      wide.removeEventListener('change', fit);
    },
  };
}
