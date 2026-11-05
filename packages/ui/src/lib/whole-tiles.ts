/**
 * A vertical rail of tiles that shows only whole ones: its height stops at the
 * last tile that fits in its grid cell, with room left under it for a cue, and
 * `data-more` says a tile waits below. A tile cut in half reads as a logo
 * without its name, so none is shown cut. Under `wideOnly`'s width the rail
 * is someone else's layout (a phone's horizontal strip) and is left alone.
 */
export function wholeTiles(rail: HTMLElement, options: { cell: () => number; cue: number; tiles: string; wideOnly: string }) {
  const wide = window.matchMedia(options.wideOnly);
  function more() {
    if (rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1) rail.dataset.more = 'true';
    else delete rail.dataset.more;
  }
  function fit() {
    if (!wide.matches) {
      rail.style.height = '';
      delete rail.dataset.more;
      return;
    }
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
