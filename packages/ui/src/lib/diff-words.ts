/**
 * The changed words inside a changed line: a removed line and the added line
 * that replaces it are compared token by token, and each side gets the
 * character ranges that differ. DiffView marks them over the line's colours.
 * Only the rows it draws are read, and a long or wholly rewritten line gets
 * no marks, so a large diff costs no more than its first screen.
 */
import type { DiffRow } from './diff';

/** Character ranges `[start, end)` of one line. */
export type Ranges = readonly (readonly [number, number])[];

type Changed = Extract<DiffRow, { kind: 'add' | 'remove' }>;

/** Past this a line is compared whole: the token table grows with the square of its length. */
const MAX_CHARS = 400;
const MAX_TOKENS = 160;
/** Below this share of kept characters the line was rewritten, and marking most of it would only add noise. */
const MIN_KEPT = 0.4;

const TOKEN = /\w+|\s+|[^\w\s]/g;

/** The ranges that differ between two lines, or null when the lines share too little or nothing differs. */
export function changedWords(before: string, after: string): { before: Ranges; after: Ranges } | null {
  if (before === after || before.length > MAX_CHARS || after.length > MAX_CHARS) return null;
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;
  const width = b.length + 1;
  // The longest common subsequence of tokens, filled from the end.
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const keptA = new Array<boolean>(a.length).fill(false);
  const keptB = new Array<boolean>(b.length).fill(false);
  let kept = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      keptA[i] = true; keptB[j] = true;
      if (a[i]!.trim()) kept += a[i]!.length;
      i += 1; j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1;
    else j += 1;
  }
  const solid = Math.max(before.replace(/\s/g, '').length, after.replace(/\s/g, '').length);
  if (solid === 0 || kept / solid < MIN_KEPT) return null;
  return { before: ranges(a, keptA), after: ranges(b, keptB) };
}

/** Runs of changed tokens as character ranges; a space between two changed words joins them. */
function ranges(tokens: string[], kept: boolean[]): Ranges {
  const out: [number, number][] = [];
  let at = 0;
  tokens.forEach((token, index) => {
    const start = at;
    at += token.length;
    if (kept[index]) return;
    const last = out.at(-1);
    if (last && last[1] === start) last[1] = at;
    else if (token.trim()) out.push([start, at]);
  });
  // A changed run never ends on the space that followed it.
  for (const range of out) {
    const text = tokens.join('').slice(range[0], range[1]);
    range[1] = range[0] + text.trimEnd().length;
  }
  return out.filter(([start, end]) => end > start);
}

/**
 * The marks of the drawn rows: each run of removed lines followed by added
 * lines pairs its first removed with its first added, and so on, as the split
 * view lays them side by side. A line left without a partner is new or gone
 * as a whole and gets none.
 */
export function wordMarks(rows: readonly DiffRow[]): Map<DiffRow, Ranges> {
  const marks = new Map<DiffRow, Ranges>();
  for (let index = 0; index < rows.length;) {
    if (rows[index]!.kind !== 'remove') { index += 1; continue; }
    const removed: Changed[] = [];
    const added: Changed[] = [];
    while (rows[index]?.kind === 'remove') removed.push(rows[index++] as Changed);
    while (rows[index]?.kind === 'add') added.push(rows[index++] as Changed);
    for (let k = 0; k < Math.min(removed.length, added.length); k += 1) {
      const words = changedWords(removed[k]!.text, added[k]!.text);
      if (!words) continue;
      if (words.before.length) marks.set(removed[k]!, words.before);
      if (words.after.length) marks.set(added[k]!, words.after);
    }
  }
  return marks;
}

/** A plain line cut at its marks, for the rows drawn before the grammar has run. */
export function markText(text: string, marks: Ranges): { text: string; marked: boolean }[] {
  const parts: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start > at) parts.push({ text: text.slice(at, start), marked: false });
    parts.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), marked: false });
  return parts;
}

const OPEN = '<mark class="word">';
const CLOSE = '</mark>';

/**
 * A highlighted line with its marks laid over the grammar's spans. The marks
 * count the line's characters, an entity as one, and close around each tag so
 * the markup stays well nested.
 */
export function markHtml(html: string, marks: Ranges): string {
  let out = '';
  let char = 0;
  let next = 0;
  let inside = false;
  const edge = () => {
    // Opens or closes a mark where the text stands, as often as ranges meet there.
    for (;;) {
      if (inside && char >= marks[next]![1]) { out += CLOSE; inside = false; next += 1; continue; }
      if (!inside && next < marks.length && char >= marks[next]![0] && char < marks[next]![1]) { out += OPEN; inside = true; continue; }
      if (!inside && next < marks.length && char >= marks[next]![1]) { next += 1; continue; }
      return;
    }
  };
  for (let i = 0; i < html.length;) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      const tag = html.slice(i, end === -1 ? html.length : end + 1);
      out += inside ? CLOSE + tag + OPEN : tag;
      i += tag.length;
      continue;
    }
    edge();
    const entity = html[i] === '&' ? /^&(#\d+|#x[0-9a-f]+|[a-z]+);/i.exec(html.slice(i, i + 12)) : null;
    const piece = entity ? entity[0] : html[i]!;
    out += piece;
    i += piece.length;
    char += 1;
  }
  edge();
  if (inside) out += CLOSE;
  return out.replaceAll(OPEN + CLOSE, '');
}
