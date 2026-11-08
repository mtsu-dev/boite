/**
 * A list label cut between words. When its text does not fit its lines (one,
 * or the label's line clamp), it ends on the last whole word that fits, then
 * "\u2026"; the browser's own ellipsis cuts inside a word ("contacts p").
 * Widths come from a canvas in the label's font, so a try lays nothing out,
 * and one ResizeObserver serves every label, read when layout is clean. A
 * cut label keeps its whole text for assistive tech in a hidden copy. Without
 * a ResizeObserver (tests), the label holds its whole text.
 */
const ELLIPSIS = '\u2026';
/** Canvas and layout round differently: a cut keeps this much room spare. */
const SLACK = 1;

const texts = new WeakMap<Element, string>();
const live = new Set<HTMLElement>();
let observer: ResizeObserver | undefined;
let pen: CanvasRenderingContext2D | null | undefined;

/** Words with their trailing spaces. A match, not a lookbehind split: Safari 15.4 has no lookbehind (docs/phone.md). */
function words(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function canvas(): CanvasRenderingContext2D | null {
  pen ??= document.createElement('canvas').getContext('2d');
  return pen;
}

/** How many lines `text` takes at `width`, wrapped the way the label wraps: between words, inside one only when it alone is too wide. */
export function lineCount(text: string, width: number, measure: (text: string) => number): number {
  let lines = 1;
  let line = '';
  for (const token of words(text)) {
    const next = line + token;
    if (measure(next.trimEnd()) <= width) {
      line = next;
      continue;
    }
    if (line.trim() !== '') lines += 1;
    let rest = token;
    while (rest.length > 1 && measure(rest.trimEnd()) > width) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut)) > width) cut -= 1;
      rest = rest.slice(cut);
      lines += 1;
    }
    line = rest;
  }
  return lines;
}

/**
 * The longest run of whole words that fits `lines` lines at `width` with the
 * ellipsis after it, or the whole text when it fits. A first word too wide to
 * fit alone gives the whole text back, for the CSS ellipsis to cut.
 */
export function wordCut(text: string, width: number, lines: number, measure: (text: string) => number): string {
  if (lineCount(text, width, measure) <= lines) return text;
  const parts = words(text);
  const at = (count: number): string => parts.slice(0, count).join('').trimEnd().replace(/[\s,;:.(-]+$/, '') + ELLIPSIS;
  let low = 0;
  let high = parts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineCount(at(mid), width, measure) <= lines) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? text : at(low);
}

function show(node: HTMLElement, text: string, shown: string): void {
  if (shown === text) {
    if (node.childElementCount > 0 || node.textContent !== text) node.textContent = text;
    return;
  }
  const visible = document.createElement('span');
  visible.setAttribute('aria-hidden', 'true');
  visible.textContent = shown;
  const whole = document.createElement('span');
  whole.className = 'visually-hidden';
  whole.textContent = text;
  node.replaceChildren(visible, whole);
}

function fit(node: HTMLElement, width: number): void {
  const text = texts.get(node) ?? '';
  const pen = canvas();
  if (!pen || width <= 0) return show(node, text, text);
  const style = getComputedStyle(node);
  pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if ('letterSpacing' in pen) pen.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  const clamp = Number.parseInt(style.getPropertyValue('-webkit-line-clamp'), 10);
  const lines = Number.isFinite(clamp) && clamp > 0 ? clamp : style.whiteSpace === 'nowrap' ? 1 : Infinity;
  if (lines === Infinity) return show(node, text, text);
  const measure = (part: string): number => pen.measureText(part).width;
  show(node, text, wordCut(text, width - SLACK, lines, measure));
}

function refitAll(): void {
  for (const node of live) fit(node, node.clientWidth);
}

export function wordFit(node: HTMLElement, text: string): { update(text: string): void; destroy(): void } {
  texts.set(node, text);
  node.textContent = text;
  if (typeof ResizeObserver === 'undefined') return { update: (next) => { texts.set(node, next); node.textContent = next; }, destroy() {} };
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) fit(entry.target as HTMLElement, entry.contentRect.width);
    });
    // A web font that lands after the first fit changes every width.
    document.fonts?.addEventListener?.('loadingdone', refitAll);
  }
  live.add(node);
  observer.observe(node);
  return {
    update(next) {
      if (next === texts.get(node)) return;
      texts.set(node, next);
      fit(node, node.clientWidth);
    },
    destroy() {
      observer?.unobserve(node);
      live.delete(node);
    }
  };
}
