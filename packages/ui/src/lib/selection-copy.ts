/**
 * What a copied selection of rendered Markdown carries: each drawing it
 * touches as its source (`lib/rich-markdown-draw.ts` marks them `md-drawn`)
 * and each file chip as the path it was written as (`lib/file-links.ts`).
 * A native block (`steps`, `bars`...) is text the reader sees: selected in
 * part, it copies what was selected. A copy that touches neither stays the
 * browser's own.
 */
const DRAWINGS = '.md-math, .md-mermaid, .md-view, .md-native';
const CHIPS = 'a.file-chip[data-source]';
/** Drawings a selection that starts or ends inside takes whole: their drawn text means nothing alone. */
const OPAQUE = '.md-math, .md-mermaid, .md-view';
/** The fields of a native block's row, split by a tab in a copied part of the block. */
const FIELDS = '.md-step-mark, .md-native-title, .md-native-detail, .md-bar-label, .md-bar-value, .md-bar-note, .md-stat-label, .md-stat-value, .md-stat-detail';
/** What a native block holds besides what it shows: its bar's buttons and the screen-reader cue. */
const UNSEEN = '.md-diagram-bar, .visually-hidden';
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
 * inside a formula, a diagram, a view or a chip takes the whole of it; a
 * native block keeps its fence only when the selection holds all of it.
 */
export function selectedSource(range: Range): string {
  const whole = range.cloneRange();
  const start = wholeOf(range.startContainer);
  if (start) whole.setStartBefore(start);
  const end = wholeOf(range.endContainer);
  if (end) whole.setEndAfter(end);
  coverNative(whole);
  const originals = clonedDrawings(whole);
  const fragment = whole.cloneContents();
  const clones = [...fragment.querySelectorAll<HTMLElement>(DRAWINGS)];
  // `cloneContents` clones every drawing `clonedDrawings` lists, in the same order; if not, each copies whole as before.
  const paired = originals.length === clones.length;
  // A selection held inside one native block clones none of its frame, or only some of its children.
  const common = whole.commonAncestorContainer;
  const inside = (common instanceof Element ? common : common.parentElement)?.closest<HTMLElement>('.md-native');
  // Its Code view is the source as written: the selected characters, line breaks and spaces included.
  if (inside && (common instanceof Element ? common : common.parentElement)?.closest('pre')) return whole.toString();
  if (inside) showPart(fragment, inside, common === inside);
  for (const [index, element] of clones.entries()) {
    // An enclosing drawing (for instance a native block holding inline math) already replaced its subtree.
    if (!fragment.contains(element)) continue;
    const original = paired ? originals[index]! : null;
    if (original && element.classList.contains('md-native') && (original.contains(whole.startContainer) || original.contains(whole.endContainer))) {
      showPart(element, original, true);
      continue;
    }
    const source = element.dataset.source ?? '';
    const fence = element.classList.contains('md-mermaid') ? 'mermaid' : element.classList.contains('md-view') ? 'view' : element.dataset.kind ?? '';
    const mark = element.dataset.fence || '```';
    const text = fence ? `${mark}${fence}\n${source}\n${mark}` : source;
    element.replaceWith(element.localName === 'div' ? blockOf(text) : document.createTextNode(text));
  }
  for (const chip of fragment.querySelectorAll<HTMLElement>(CHIPS)) chip.replaceWith(document.createTextNode(chip.dataset.source ?? ''));
  return plainText(fragment).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Widens `range` over each native block whose start or end it reaches, so a
 * range over all of a block's contents copies it as its fence.
 */
function coverNative(range: Range): void {
  const contents = range.cloneRange();
  const at = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.md-native');
  for (let block = at(range.startContainer); block; block = block.parentElement && at(block.parentElement)) {
    contents.selectNodeContents(block);
    if (range.compareBoundaryPoints(range.START_TO_START, contents) > 0) break;
    range.setStartBefore(block);
  }
  for (let block = at(range.endContainer); block; block = block.parentElement && at(block.parentElement)) {
    contents.selectNodeContents(block);
    if (range.compareBoundaryPoints(range.END_TO_END, contents) < 0) break;
    range.setEndAfter(block);
  }
}

/**
 * The drawings of the document that `range.cloneContents()` copies, in document
 * order: those the range meets below the node holding all of it.
 */
function clonedDrawings(range: Range): HTMLElement[] {
  const common = range.commonAncestorContainer;
  if (!(common instanceof Element)) return [];
  return [...common.querySelectorAll<HTMLElement>(DRAWINGS)].filter(element => range.intersectsNode(element));
}

/**
 * A copied part of the native block `original` as it reads on screen: without
 * its buttons or hidden cues and, when `root` holds the block's own children,
 * only the view it shows (the drawing or, switched to Code, its source).
 */
function showPart(root: ParentNode, original: HTMLElement, children: boolean): void {
  for (const unseen of root.querySelectorAll(UNSEEN)) unseen.remove();
  if (!children) return;
  const drawn = original.querySelector(':scope > .md-native-figure');
  const shown = original.dataset.view === 'code' || !drawn ? 'pre' : '.md-native-figure';
  for (const child of [...root.children]) if (!child.matches(shown)) child.remove();
}

/** A drawing that was a block stays one in the copied text. */
function blockOf(text: string): HTMLParagraphElement {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  return paragraph;
}

/** Outermost formula, diagram, view or chip containing `at`; a native block is text and is never taken whole for it. */
function wholeOf(at: Node): Element | null {
  const selector = `${OPAQUE}, ${CHIPS}`;
  let found: Element | null = null;
  for (let current = (at instanceof Element ? at : at.parentElement)?.closest(selector) ?? null; current; current = current.parentElement?.closest(selector) ?? null) found = current;
  return found;
}

/** Ends a native block's field; one between two fields of a row becomes a tab. */
const FIELD_END = '\u001f';

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
    const before = out.length;
    for (const child of current.childNodes) walk(child);
    if (name === 'td' || name === 'th') out += '\t';
    // A field ends with a mark, even when its row was not copied: a selection inside one row clones its fields alone.
    if (current instanceof Element && current.matches(FIELDS) && out.slice(before).trim()) out += FIELD_END;
    if (block && !out.endsWith('\n')) out += '\n';
    if (SPACED.has(name)) out += '\n';
  };
  walk(root);
  return out.replace(/\u001f+(?=\n|$)/g, '').replace(/\u001f+/g, '\t');
}
