/**
 * What a copied selection of rendered Markdown carries: each drawing it
 * touches as its source (`lib/rich-markdown-draw.ts` marks them `md-drawn`)
 * and each file chip as the path it was written as (`lib/file-links.ts`).
 * A copy that touches neither stays the browser's own.
 */
const DRAWINGS = '.md-math, .md-mermaid, .md-view, .md-native';
const CHIPS = 'a.file-chip[data-source]';
const BLOCKS = new Set(['p', 'div', 'li', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'ul', 'ol', 'hr']);
/** Blocks a blank line separates in Markdown. */
const SPACED = new Set(['p', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol']);

/** Puts the source of every drawing and chip the selection touches on the clipboard. */
export function copySource(node: HTMLElement, event: ClipboardEvent): void {
  const selection = node.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !event.clipboardData) return;
  const range = selection.getRangeAt(0);
  if (!node.contains(range.commonAncestorContainer)) return;
  const touched = [...node.querySelectorAll(`.md-drawn, ${CHIPS}`)].some(element => range.intersectsNode(element));
  if (!touched) return;
  event.clipboardData.setData('text/plain', selectedSource(range));
  event.preventDefault();
}

/**
 * The text of a selection with each drawing it touches as its source: a
 * formula as written with its delimiters, a diagram or a view as its fenced
 * block, a file chip as its whole path. A selection that starts or ends
 * inside one takes the whole of it.
 */
export function selectedSource(range: Range): string {
  const whole = range.cloneRange();
  const start = wholeOf(range.startContainer);
  if (start) whole.setStartBefore(start);
  const end = wholeOf(range.endContainer);
  if (end) whole.setEndAfter(end);
  const fragment = whole.cloneContents();
  for (const element of fragment.querySelectorAll<HTMLElement>(DRAWINGS)) {
    // An enclosing drawing (for instance a native block holding inline math) already replaced its subtree.
    if (!fragment.contains(element)) continue;
    const source = element.dataset.source ?? '';
    const fence = element.classList.contains('md-mermaid') ? 'mermaid' : element.classList.contains('md-view') ? 'view' : element.dataset.kind ?? '';
    const mark = element.dataset.fence || '```';
    const text = fence ? `${mark}${fence}\n${source}\n${mark}` : source;
    element.replaceWith(element.localName === 'div' ? blockOf(text) : document.createTextNode(text));
  }
  for (const chip of fragment.querySelectorAll<HTMLElement>(CHIPS)) chip.replaceWith(document.createTextNode(chip.dataset.source ?? ''));
  return plainText(fragment).replace(/\n{3,}/g, '\n\n').trim();
}

/** A drawing that was a block stays one in the copied text. */
function blockOf(text: string): HTMLParagraphElement {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  return paragraph;
}

/** Outermost drawing or chip containing `at`: a formula inside a native block belongs to that block's source. */
function wholeOf(at: Node): Element | null {
  const selector = `${DRAWINGS}, ${CHIPS}`;
  let found: Element | null = null;
  for (let current = (at instanceof Element ? at : at.parentElement)?.closest(selector) ?? null; current; current = current.parentElement?.closest(selector) ?? null) found = current;
  return found;
}

/** Text with the line breaks its blocks imply: `textContent` would run two paragraphs together. */
function plainText(root: Node): string {
  let out = '';
  const walk = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE) { out += current.nodeValue ?? ''; return; }
    if (!(current instanceof Element) && current.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const name = current instanceof Element ? current.localName : '';
    if (name === 'br') { out += '\n'; return; }
    const block = BLOCKS.has(name);
    if (block && out && !out.endsWith('\n')) out += '\n';
    for (const child of current.childNodes) walk(child);
    if (name === 'td' || name === 'th') out += '\t';
    if (block && !out.endsWith('\n')) out += '\n';
    if (SPACED.has(name)) out += '\n';
  };
  walk(root);
  return out;
}
