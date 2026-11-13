/**
 * Scrolls a Settings card into view, `settings-<id>` in the DOM, and when a
 * settings card in a conversation pointed at it, rings it once in the accent
 * colour so the eye lands on it (`.settings-flash` in app.css). False when the
 * page has no such card.
 */
export function revealSettingsCard(id: string, flash: boolean, behavior: ScrollBehavior): boolean {
  const target = document.getElementById(`settings-${id}`);
  if (!target) return false;
  target.scrollIntoView({ behavior, block: 'start' });
  if (flash) {
    target.classList.remove('settings-flash');
    // Restart the animation when the same card is pointed at twice in a row.
    void target.offsetWidth;
    target.classList.add('settings-flash');
    target.addEventListener('animationend', () => target.classList.remove('settings-flash'), { once: true });
  }
  return true;
}

/**
 * Keeps a merged section (`settings-<id>`, the task manager under Diagnostics)
 * at the top of its scroller while the pages settle: Diagnostics mounts and
 * fills in (the log, the problems) after the first scroll, which left the
 * section halfway down. Each frame it brings the section's top back to where
 * the scroller starts, until the reader scrolls, presses or types, or `ms`
 * pass. Returns the release.
 */
export function holdSettingsCard(id: string, ms = 2000): () => void {
  const target = document.getElementById(`settings-${id}`);
  let scroller = target?.parentElement ?? null;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (!target || !scroller) return () => {};
  const box = scroller;
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const started = performance.now();
  let frame = 0;
  const pin = () => {
    const drift = target.getBoundingClientRect().top - box.getBoundingClientRect().top - margin;
    if (Math.abs(drift) > 1) box.scrollTop += drift;
    frame = performance.now() - started < ms ? requestAnimationFrame(pin) : 0;
    if (!frame) release();
  };
  const events = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
  function release() {
    cancelAnimationFrame(frame);
    for (const name of events) window.removeEventListener(name, release, true);
  }
  for (const name of events) window.addEventListener(name, release, true);
  frame = requestAnimationFrame(pin);
  return release;
}
