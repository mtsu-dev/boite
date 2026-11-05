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
