/**
 * Finds labels whose descenders a clipping box cuts off: a `.ui-label` is
 * trimmed to its cap height and baseline (`text-box: trim-both cap alphabetic`
 * in `app.css`), and its half-em padding gives the tails of g, p and y back.
 * An ancestor with `overflow: hidden` sized to the trimmed box clips that
 * padding away, so "steps" reads "steos". Scroll containers are left out:
 * a row half scrolled out of a list is cut on purpose.
 */

export interface Clipped {
  text: string;
  /** How many pixels of the descender band the box cuts. */
  cut: number;
  /** The clipping box, as a short CSS path. */
  box: string;
}

/** The share of an em under the baseline that g, p and y need in Inter. */
const DESCENDER = 0.2;
/** How many ancestors up a clip is still the label's own box, not a page region. */
const DEPTH = 4;

export async function auditClipping(page: any): Promise<Clipped[]> {
  return page.evaluate(({ descender, depth }: { descender: number; depth: number }) => {
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].filter(c => !c.startsWith('s-')).join('.') : ''}`;
    const found: { text: string; cut: number; box: string }[] = [];
    for (const label of document.querySelectorAll<HTMLElement>('.ui-label')) {
      const text = label.textContent?.trim() ?? '';
      const rect = label.getBoundingClientRect();
      if (!text || !rect.width || !rect.height || !label.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const style = getComputedStyle(label);
      const baseline = rect.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
      const needed = baseline + descender * parseFloat(style.fontSize);
      let el = label.parentElement;
      for (let level = 0; el && el !== document.body && level < depth; level++, el = el.parentElement) {
        const box = getComputedStyle(el);
        if (!['hidden', 'clip'].includes(box.overflowY)) continue;
        const bottom = el.getBoundingClientRect().bottom - parseFloat(box.borderBottomWidth);
        // Only a cut through the descender band: a label wholly outside the box is hidden, not clipped.
        if (baseline < bottom && needed > bottom + 0.5) {
          found.push({ text: text.slice(0, 60), cut: Math.round((needed - bottom) * 10) / 10, box: name(el) });
          break;
        }
      }
    }
    return found;
  }, { descender: DESCENDER, depth: DEPTH });
}

export function formatClipping(found: Clipped[]): string {
  return found.map(one => `${JSON.stringify(one.text)} cut ${one.cut}px by ${one.box}`).join('\n') + '\n';
}

export interface Truncated {
  text: string;
  /** Pixels shown and pixels the whole text needs. */
  shown: number;
  needed: number;
  /** A control's own name (a tab, a chip, a button), not a title the user wrote. */
  label: boolean;
}

/** A short text inside a control is its name: cutting it is a defect. Longer runs are titles and paths, cut on purpose. */
const LABEL_LENGTH = 40;

/**
 * Finds text an ellipsis or a hidden overflow cuts sideways: "Conversatio..." on a tab,
 * "Claude · Pick a" on a chip. The descender audit above never sees those.
 */
export async function auditTruncation(page: any): Promise<Truncated[]> {
  return page.evaluate((limit: number) => {
    const found: { text: string; shown: number; needed: number; label: boolean }[] = [];
    const controls = 'button, a, label, summary, [role=tab], [role=menuitem], [role=menuitemradio], [role=option], [role=radio], [role=switch]';
    const rows = '[data-testid=thread-row], [data-testid=mobile-row], [data-testid^=mobile-thread-], [data-testid=inbox-card], [data-testid=inbox-card-bot]';
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (!el.firstChild || el.children.length > 2) continue;
      const style = getComputedStyle(el);
      if (style.textOverflow !== 'ellipsis' && !(['hidden', 'clip'].includes(style.overflowX) && style.whiteSpace === 'nowrap')) continue;
      // A visually hidden name (1 px wide, clipped) is for screen readers, not cut.
      if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth <= 2) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      // A thread's title, a card's text or a path: what a row holds is the user's, and the row cuts it on purpose.
      const content = !!el.closest(rows) || !!el.closest('[class*=title], [data-testid*=title], h1, h2, h3, .path, .branch, code');
      found.push({ text: text.slice(0, 80), shown: el.clientWidth, needed: el.scrollWidth, label: !content && !!el.closest(controls) && text.length <= limit });
    }
    // The innermost cut element carries the text; drop an ancestor that repeats it.
    return found.filter((one, i) => !found.some((other, j) => j > i && other.text === one.text));
  }, LABEL_LENGTH);
}

export function formatTruncation(found: Truncated[]): string {
  const line = (one: Truncated) => `${JSON.stringify(one.text)} ${one.shown} of ${one.needed}px`;
  const labels = found.filter(one => one.label), content = found.filter(one => !one.label);
  return [`labels cut: ${labels.length}`, ...labels.map(line), `titles and paths cut on purpose: ${content.length}`, ...content.map(line)].join('\n') + '\n';
}
