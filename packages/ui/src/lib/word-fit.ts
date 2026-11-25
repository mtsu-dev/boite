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
type FitState = { text: string; width: number; shown: string };
const fitted = new WeakMap<Element, FitState>();
const live = new Set<HTMLElement>();
const dirty = new Set<HTMLElement>();
const cutCache = new Map<string, string>();
const CUT_CACHE_MAX = 2000;
let observer: ResizeObserver | undefined;
let pen: CanvasRenderingContext2D | null | undefined;
let flushFrame = 0;

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

function cachedCut(pen: CanvasRenderingContext2D, font: string, letterSpacing: string, lines: number, width: number, text: string): string {
  const key = `${font}\0${letterSpacing}\0${lines}\0${Math.round(width * 2)}\0${text}`;
  const hit = cutCache.get(key);
  if (hit !== undefined) return hit;
  pen.font = font;
  if ('letterSpacing' in pen) pen.letterSpacing = letterSpacing;
  const shown = wordCut(text, width - SLACK, lines, (part: string) => pen.measureText(part).width);
  if (cutCache.size >= CUT_CACHE_MAX) cutCache.clear();
  cutCache.set(key, shown);
  return shown;
}

type PendingWrite = { node: HTMLElement; text: string; width: number; shown: string };

/**
 * Two-phase batch: read every node's style and measure on canvas before writing any DOM,
 * so a burst of mounted rows never interleaves getComputedStyle with replaceChildren.
 */
function fitBatch(items: Array<{ node: HTMLElement; width: number }>, force = false): void {
  const ctx = canvas();
  const writes: PendingWrite[] = [];
  for (const { node, width } of items) {
    if (!node.isConnected) continue;
    const text = texts.get(node) ?? '';
    const prev = fitted.get(node);
    if (!force && prev && prev.text === text && Math.abs(prev.width - width) < 0.5) continue;
    let shown = text;
    if (ctx && width > 0) {
      const style = getComputedStyle(node);
      const clamp = Number.parseInt(style.getPropertyValue('-webkit-line-clamp'), 10);
      const lines = Number.isFinite(clamp) && clamp > 0 ? clamp : style.whiteSpace === 'nowrap' ? 1 : Infinity;
      if (lines !== Infinity) {
        const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
        shown = cachedCut(ctx, font, letterSpacing, lines, width, text);
      }
    }
    writes.push({ node, text, width, shown });
  }
  for (const { node, text, width, shown } of writes) {
    const prev = fitted.get(node);
    fitted.set(node, { text, width, shown });
    if (!prev || prev.shown !== shown || prev.text !== text) show(node, text, shown);
  }
}

function flushDirty(): void {
  flushFrame = 0;
  if (dirty.size === 0) return;
  const items: Array<{ node: HTMLElement; width: number }> = [];
  for (const node of dirty) {
    if (node.isConnected) items.push({ node, width: node.clientWidth });
  }
  dirty.clear();
  if (items.length > 0) fitBatch(items, true);
}

function scheduleRefit(node: HTMLElement): void {
  dirty.add(node);
  if (flushFrame) return;
  if (typeof requestAnimationFrame === 'function') {
    flushFrame = requestAnimationFrame(flushDirty);
  } else {
    flushDirty();
  }
}

function refitAll(): void {
  cutCache.clear();
  const items: Array<{ node: HTMLElement; width: number }> = [];
  for (const node of live) {
    if (node.isConnected) items.push({ node, width: node.clientWidth });
  }
  if (items.length > 0) fitBatch(items, true);
}

export function wordFit(node: HTMLElement, text: string): { update(text: string): void; destroy(): void } {
  texts.set(node, text);
  fitted.delete(node);
  node.textContent = text;
  if (typeof ResizeObserver === 'undefined') return { update: (next) => { texts.set(node, next); node.textContent = next; }, destroy() {} };
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      const items: Array<{ node: HTMLElement; width: number }> = [];
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        dirty.delete(target);
        items.push({ node: target, width: entry.contentRect.width });
      }
      if (items.length > 0) fitBatch(items);
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
      scheduleRefit(node);
    },
    destroy() {
      observer?.unobserve(node);
      live.delete(node);
      dirty.delete(node);
      fitted.delete(node);
    }
  };
}
