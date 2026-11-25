/**
 * The four blocks chat draws from a few plain lines, with no page and no
 * round trip: ```steps, ```options, ```bars and ```stats (`lib/markdown.ts`
 * marks them `md-native`). One grammar for all four: a line is an item, blank
 * lines are skipped, `|` splits its fields (`\|` is a literal pipe, `\\` a
 * literal backslash) and a leading `* ` highlights it. A block with no item,
 * more than `MAX_ITEMS`, a field too many or a bar it cannot measure is not
 * drawn: it stays code.
 *
 * Structure is built with DOM calls; a field's text goes through the escaped
 * inline renderer (`markdown-inline.ts`, no HTML, no `javascript:` link).
 */
import { inline } from './markdown-inline';

export const NATIVE_KINDS = ['steps', 'options', 'bars', 'stats'] as const;
export type NativeKind = typeof NATIVE_KINDS[number];

export const MAX_ITEMS = 30;

export interface NativeItem {
  accent: boolean;
  /** The title of a step or an option, the label of a bar or a stat. */
  title: string;
  /** A bar's or a stat's value as written. */
  value?: string;
  /** A bar's share of the longest one, 0 to 1. */
  share?: number;
  /** A step's or an option's detail, a bar's note, a stat's delta. */
  detail?: string;
}

/** The fields each kind takes: the least and the most. */
const FIELDS: Record<NativeKind, [number, number]> = { steps: [1, 2], options: [1, 2], bars: [2, 3], stats: [2, 3] };
const STEP_MARK = /^(?:\d{1,3}[.)]|[-+])\s+/;

export function isNativeKind(kind: string): kind is NativeKind {
  return (NATIVE_KINDS as readonly string[]).includes(kind);
}

/** The items of a block, or null when it should stay code. */
export function parseNative(kind: NativeKind, source: string): NativeItem[] | null {
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_ITEMS) return null;
  const [least, most] = FIELDS[kind];
  const items: NativeItem[] = [];
  for (const line of lines) {
    const accent = /^\*\s/.test(line);
    let rest = accent ? line.slice(1).trim() : line;
    if (kind === 'steps') rest = rest.replace(STEP_MARK, '');
    const fields = split(rest);
    if (fields.length < least || fields.length > most || fields.slice(0, least).some(field => !field)) return null;
    const [title, second, third] = fields as [string, string?, string?];
    if (kind === 'steps' || kind === 'options') items.push({ accent, title, ...(second ? { detail: second } : {}) });
    else items.push({ accent, title, value: second!, ...(third ? { detail: third } : {}) });
  }
  if (kind === 'bars' && !measure(items)) return null;
  return items;
}

/**
 * A line's fields, trimmed. A backslash escapes the next character, so `\\|`
 * is a pipe in its field and `\\\\|` a backslash before a separator; the
 * escapes other than the pipe stay for the inline renderer to read.
 */
function split(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    const next = line[index + 1];
    if (char === '\\' && next !== undefined) { field += next === '|' ? '|' : char + next; index++; continue; }
    if (char === '|') { fields.push(field.trim()); field = ''; continue; }
    field += char;
  }
  fields.push(field.trim());
  return fields;
}

/** Units that compare across rows: each family's scale to its base. Any other unit must be the same on every row. */
const UNITS = new Map<string, [family: string, scale: number]>([
  ['ns', ['time', 1e-9]], ['us', ['time', 1e-6]], ['µs', ['time', 1e-6]], ['ms', ['time', 1e-3]], ['s', ['time', 1]], ['sec', ['time', 1]], ['min', ['time', 60]], ['h', ['time', 3600]],
  ['b', ['bytes', 1]], ['kb', ['bytes', 1e3]], ['mb', ['bytes', 1e6]], ['gb', ['bytes', 1e9]], ['tb', ['bytes', 1e12]],
  ['kib', ['bytes', 1024]], ['mib', ['bytes', 1024 ** 2]], ['gib', ['bytes', 1024 ** 3]], ['tib', ['bytes', 1024 ** 4]],
  ['', ['count', 1]], ['k', ['count', 1e3]], ['m', ['count', 1e6]], ['bn', ['count', 1e9]],
  ['%', ['percent', 1]]
]);
/**
 * A number, then what follows it. The number is grouped by thousands
 * (`1,250`, `12,500.5`), plain (`42`, `4.2`, `.5`) or a decimal comma that
 * cannot read as a group (`4,2`, `4,25`); a comma before three digits groups
 * thousands, so `1234,567` matches nothing. The rest is read apart (`UNIT`),
 * after its length: no pattern here can backtrack over a long field.
 */
const VALUE = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+,(?:\d{1,2}|\d{4,})|\d+(?:\.\d+)?|\.\d+)\s*([^\s\d,.].*)?$/u;
const UNIT_LENGTH = 16;
/** A unit starts with a letter, `%` or `°`, and may have one `/` or space part (`req/s`). Its classes never overlap. */
const UNIT = /^[\p{L}%°][^\s\d/]*(?:[\s/][^\s\d/]+)?$/u;

/** A value as a number in its family's base unit, or null when it is not a finite, non-negative measure. */
export function readValue(text: string): { family: string; amount: number } | null {
  const match = VALUE.exec(text.trim());
  if (!match) return null;
  const number = match[1]!;
  const digits = /,\d{3}(?:\D|$)/.test(number) ? number.replaceAll(',', '') : number.replace(',', '.');
  const unit = match[2] ?? '';
  if (unit.length > UNIT_LENGTH || (unit && !UNIT.test(unit))) return null;
  // Case does not matter: `M` and `m` are a million, so time spells out `min`.
  const [family, scale] = UNITS.get(unit.toLowerCase()) ?? [`unit:${unit}`, 1];
  const amount = Number(digits) * scale;
  return Number.isFinite(amount) ? { family, amount } : null;
}

/** Sets each bar's share: against 100 for percentages up to 100, else against the longest bar. False when rows do not compare. */
function measure(items: NativeItem[]): boolean {
  const values = items.map(item => readValue(item.value ?? ''));
  if (values.some(value => !value)) return false;
  const family = values[0]!.family;
  if (values.some(value => value!.family !== family)) return false;
  const longest = Math.max(...values.map(value => value!.amount));
  const scale = family === 'percent' && longest <= 100 ? 100 : longest;
  if (!Number.isFinite(scale)) return false;
  items.forEach((item, index) => { item.share = scale > 0 ? values[index]!.amount / scale : 0; });
  return true;
}

/** The widest a bar's value is drawn, in characters, so its track keeps the row. */
const VALUE_CH = 14;

/** The drawing of a block's items, made of elements and escaped inline text only. */
export function drawNative(kind: NativeKind, items: NativeItem[]): HTMLElement {
  const list = document.createElement(kind === 'steps' ? 'ol' : kind === 'stats' ? 'dl' : 'ul');
  list.className = `md-${kind}`;
  if (items.some(item => item.accent)) list.classList.add('md-has-accent');
  // Every bar's value column is as wide as the longest value, so the tracks line up without a subgrid.
  if (kind === 'bars') list.style.setProperty('--md-bar-value', `${Math.min(VALUE_CH, Math.max(...items.map(item => item.value?.length ?? 0)))}ch`);
  for (const [index, item] of items.entries()) {
    const row = document.createElement(kind === 'stats' ? 'div' : 'li');
    row.className = `md-${kind.slice(0, -1)}`;
    if (item.accent) row.classList.add('md-accent');
    if (kind === 'steps') {
      const mark = part('span', 'md-step-mark', String(index + 1), true);
      mark.setAttribute('aria-hidden', 'true');
      row.append(mark, body(item));
    }
    else if (kind === 'options') row.append(body(item));
    else if (kind === 'bars') {
      const track = part('span', 'md-bar-track', '');
      const fill = part('span', 'md-bar-fill', '');
      const share = Math.round((item.share ?? 0) * 1000) / 10;
      fill.style.setProperty('--share', `${share}%`);
      // A value too small to see keeps a sliver; a zero stays an empty track.
      if (!item.share) fill.classList.add('md-bar-zero');
      track.append(fill);
      const value = part('span', 'md-bar-value', item.value ?? '', true);
      // The value column stops at `VALUE_CH`, cut with an ellipsis; the whole value stays in its tooltip.
      if ((item.value?.length ?? 0) > VALUE_CH) value.title = item.value!;
      row.append(part('span', 'md-bar-label', item.title), track, value);
      if (item.detail) row.append(part('span', 'md-bar-note', item.detail));
    } else {
      row.append(part('dt', 'md-stat-label', item.title), part('dd', 'md-stat-value', item.value ?? ''));
      if (item.detail) row.append(part('dd', 'md-stat-detail', item.detail));
    }
    list.append(row);
  }
  return list;
}

function body(item: NativeItem): HTMLElement {
  const wrap = part('span', 'md-native-body', '');
  wrap.append(part('span', 'md-native-title', item.title));
  if (item.detail) wrap.append(part('span', 'md-native-detail', item.detail));
  return wrap;
}

/** An element holding `text` as escaped inline Markdown, or as plain text when `plain`. */
function part(tag: string, className: string, text: string, plain = false): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  if (plain) element.textContent = text;
  else if (text) element.innerHTML = inline(text, false);
  return element;
}
