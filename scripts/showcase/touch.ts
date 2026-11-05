/**
 * Measures what a finger really hits on a phone screen. A control's box can be
 * smaller than its hit area (a `::after` inset widens it) or larger (a
 * neighbour drawn over it narrows it), so the box says little: this walks out
 * from the control's centre, one pixel at a time on each axis, while
 * `elementFromPoint` still lands on the control. Links inside prose are left
 * out, as WCAG leaves inline targets out.
 */

export interface Target {
  name: string;
  width: number;
  height: number;
}

/** How far from the centre to look, in CSS pixels: past 30 a target is wide enough either way. */
const REACH = 30;

export async function auditTouch(page: any): Promise<Target[]> {
  return page.evaluate((reach: number) => {
    const found: { name: string; width: number; height: number }[] = [];
    const selector = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab], [role=switch], [role=menuitem], [role=option], [role=checkbox], [role=radio]';
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (el.closest('.prose, [inert]') || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const box = el.getBoundingClientRect();
      // Only targets wholly on screen: one half scrolled out is a scroll position.
      if (!box.width || !box.height || box.top < 0 || box.bottom > innerHeight || box.left < 0 || box.right > innerWidth) continue;
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      const hits = (x: number, y: number) => { const at = document.elementFromPoint(x, y); return !!at && (at === el || el.contains(at)); };
      // Covered at its centre: something else takes the tap, which the screen shows; not this audit's to judge.
      if (!hits(cx, cy)) continue;
      // Half under floating chrome (the tab bar capsule over the list's last rows): a scroll position, not a target size.
      const floating = (x: number, y: number) => {
        for (let at = document.elementFromPoint(x, y) as HTMLElement | null; at && at !== document.body; at = at.parentElement) {
          if (at === el || at.contains(el)) return false;
          if (['fixed', 'sticky', 'absolute'].includes(getComputedStyle(at).position)) return true;
        }
        return false;
      };
      if (floating(cx, box.top + 1) || floating(cx, box.bottom - 1)) continue;
      const span = (dx: number, dy: number) => { let n = 0; while (n < reach && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++; return n; };
      const width = span(-1, 0) + span(1, 0) + 1, height = span(0, -1) + span(0, 1) + 1;
      if (width >= 44 && height >= 44) continue;
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('data-testid') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 50);
      found.push({ name, width, height });
    }
    return found.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height));
  }, REACH);
}

export function formatTouch(found: Target[]): string {
  const under = found.filter(one => Math.min(one.width, one.height) < 24);
  const lines = (list: Target[]) => list.map(one => `${JSON.stringify(one.name)} ${one.width}x${one.height}`);
  return [
    `under 24 px (WCAG 2.5.8 AA): ${under.length}`, ...lines(under),
    `24 to 43 px (under the 44 px of the platform guides): ${found.length - under.length}`, ...lines(found.filter(one => Math.min(one.width, one.height) >= 24)),
  ].join('\n') + '\n';
}
