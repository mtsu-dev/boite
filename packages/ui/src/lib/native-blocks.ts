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
import { strings } from './strings';

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

/**
 * Units that compare across rows: each family's scale to its base. Case is
 * preserved so bits (`b`..`Tb`) and bytes (`B`..`TB`) stay separate families
 * (mixing `kb` and `MB` falls back to code instead of guessing 1:8) and `m`
 * stays meters rather than millions (`M`). Any other unit must match on every row.
 */
const UNITS = new Map<string, [family: string, scale: number]>([
  ['ns', ['time', 1e-9]], ['us', ['time', 1e-6]], ['µs', ['time', 1e-6]], ['μs', ['time', 1e-6]], ['ms', ['time', 1e-3]], ['s', ['time', 1]], ['sec', ['time', 1]], ['min', ['time', 60]], ['h', ['time', 3600]],
  ['b', ['bits', 1]], ['kb', ['bits', 1e3]], ['Kb', ['bits', 1e3]], ['Mb', ['bits', 1e6]], ['Gb', ['bits', 1e9]], ['Tb', ['bits', 1e12]],
  ['Kib', ['bits', 1024]], ['Mib', ['bits', 1024 ** 2]], ['Gib', ['bits', 1024 ** 3]], ['Tib', ['bits', 1024 ** 4]],
  ['B', ['bytes', 1]], ['kB', ['bytes', 1e3]], ['KB', ['bytes', 1e3]], ['MB', ['bytes', 1e6]], ['GB', ['bytes', 1e9]], ['TB', ['bytes', 1e12]],
  ['KiB', ['bytes', 1024]], ['MiB', ['bytes', 1024 ** 2]], ['GiB', ['bytes', 1024 ** 3]], ['TiB', ['bytes', 1024 ** 4]],
  ['', ['count', 1]], ['k', ['count', 1e3]], ['K', ['count', 1e3]], ['M', ['count', 1e6]], ['bn', ['count', 1e9]], ['Bn', ['count', 1e9]],
  ['%', ['percent', 1]]
]);
const MAGNITUDES = new Map<string, number>([['k', 1e3], ['K', 1e3], ['M', 1e6], ['bn', 1e9], ['Bn', 1e9]]);
/**
 * An optional leading currency symbol, a number, then what follows it. The
 * number is space-grouped (`1 250`, `1 250,5`), comma-grouped (`1,250`,
 * `12,500.5`), a decimal comma (`0,125`, `4,2`, `4,25`) or plain (`42`, `4.2`,
 * `.5`). A leading zero never groups thousands (`0,125` is 0.125). The rest is
 * checked apart (`UNIT`), after its length: no pattern here backtracks over a
 * long field.
 */
const VALUE = /^(?:(\p{Sc})[ \t\u00A0\u202F]*)?([1-9]\d{0,2}(?:[ \u00A0\u202F]\d{3})+(?:[.,]\d+)?|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?|0,\d+|[1-9]\d*,(?:\d{1,2}|\d{4,})|\d+(?:\.\d+)?|\.\d+)(?:[ \t\u00A0\u202F]*(\S[\s\S]*))?$/u;
const UNIT_LENGTH = 16;
/** A non-currency unit starts with a letter, `%` or `°`, with no currency symbols and at most one `/` or space part (`req/s`). */
const UNIT = /^[\p{L}%°][^\s\d/\p{Sc}]*(?:[ \t/][^\s\d/\p{Sc}]+)?$/u;
const CURRENCY = /^\p{Sc}$/u;
const MAG_CURRENCY = /^([kKM]|bn|Bn)[ \t\u00A0\u202F]*(\p{Sc})$/u;
const PER_SUFFIX = /^\/[^\s\d/\p{Sc}]+$/u;
const CURRENCY_PER = /^(\p{Sc})(\/[^\s\d/\p{Sc}]+)$/u;
const SPACE_GROUP = /[ \u00A0\u202F]/;
const AMBIGUOUS_COMMA = /^[1-9]\d{0,2},\d{3}$/;

type CommaStyle = 'decimal' | 'english' | 'ambiguous' | 'neutral';

interface ParsedValue {
  family: string;
  amount: number;
  style: CommaStyle;
}

function classify(number: string): CommaStyle {
  if (SPACE_GROUP.test(number)) return number.includes(',') ? 'decimal' : number.includes('.') ? 'english' : 'neutral';
  if (AMBIGUOUS_COMMA.test(number)) return 'ambiguous';
  if (number.includes('.')) return 'english';
  if (!number.includes(',')) return 'neutral';
  // Multiple commas (1,000,000) group thousands; a single comma here is 0,\d+ or non-3-digit fractional.
  return number.indexOf(',') !== number.lastIndexOf(',') ? 'english' : 'decimal';
}

function parseNumber(number: string, style: CommaStyle, commaDecimal: boolean): number {
  const clean = number.replace(/[ \u00A0\u202F]/g, '');
  const asDecimal = style === 'decimal' || (style === 'ambiguous' && commaDecimal);
  const digits = asDecimal ? clean.replace(',', '.') : clean.replaceAll(',', '');
  return Number(digits);
}

function resolveUnit(prefix: string, tail: string): [family: string, scale: number] | null {
  if (tail.length > UNIT_LENGTH) return null;
  if (prefix) {
    if (!tail) return [`currency:${prefix}`, 1];
    const magnitude = MAGNITUDES.get(tail);
    if (magnitude !== undefined) return [`currency:${prefix}`, magnitude];
    if (PER_SUFFIX.test(tail)) return [`unit:${prefix}${tail}`, 1];
    return null;
  }
  if (!tail) return ['count', 1];
  if (CURRENCY.test(tail)) return [`currency:${tail}`, 1];
  const priced = MAG_CURRENCY.exec(tail);
  if (priced) return [`currency:${priced[2]!}`, MAGNITUDES.get(priced[1]!)!];
  const rate = CURRENCY_PER.exec(tail);
  if (rate) return [`unit:${rate[1]!}${rate[2]!}`, 1];
  if (!UNIT.test(tail)) return null;
  return UNITS.get(tail) ?? [`unit:${tail}`, 1];
}

function readParsed(text: string, commaDecimal: boolean): ParsedValue | null {
  const match = VALUE.exec(text.trim());
  if (!match) return null;
  const prefix = match[1] ?? '';
  const number = match[2]!;
  const tail = match[3] ?? '';
  const resolved = resolveUnit(prefix, tail);
  if (!resolved) return null;
  const style = classify(number);
  const amount = parseNumber(number, style, commaDecimal) * resolved[1];
  return Number.isFinite(amount) ? { family: resolved[0], amount, style } : null;
}

/** A value as a number in its family's base unit, or null when it is not a finite, non-negative measure. */
export function readValue(text: string, commaDecimal = false): { family: string; amount: number } | null {
  const parsed = readParsed(text, commaDecimal);
  return parsed ? { family: parsed.family, amount: parsed.amount } : null;
}

/**
 * Sets each bar's share: against 100 for percentages up to 100, else against
 * the longest bar. False when rows do not compare or mix conflicting decimal
 * conventions (`2,5` with `4.2` or `1,250.5`).
 */
function measure(items: NativeItem[]): boolean {
  const initial = items.map(item => readParsed(item.value ?? '', false));
  if (initial.some(value => !value)) return false;
  const parsed = initial as ParsedValue[];
  const hasDecimalComma = parsed.some(value => value.style === 'decimal');
  const hasEnglish = parsed.some(value => value.style === 'english');
  if (hasDecimalComma && hasEnglish) return false;
  // When any row uses a decimal comma (`0,750`, `2,5`), ambiguous `1,500` rows in the same block follow it.
  const values = hasDecimalComma && parsed.some(value => value.style === 'ambiguous')
    ? items.map(item => readParsed(item.value ?? '', true)!)
    : parsed;
  const family = values[0]!.family;
  if (values.some(value => value.family !== family)) return false;
  const longest = Math.max(...values.map(value => value.amount));
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
  // `list-style: none` removes implicit list semantics in WebKit/VoiceOver.
  if (kind !== 'stats') list.setAttribute('role', 'list');
  const accented = items.filter(item => item.accent).length;
  if (accented > 0) list.classList.add('md-has-accent');
  // Every bar's value column is as wide as the longest value, so the tracks line up without a subgrid.
  if (kind === 'bars') list.style.setProperty('--md-bar-value', `${Math.min(VALUE_CH, Math.max(...items.map(item => item.value?.length ?? 0)))}ch`);
  for (const [index, item] of items.entries()) {
    const row = document.createElement(kind === 'stats' ? 'div' : 'li');
    row.className = `md-${kind.slice(0, -1)}`;
    // `aria-current="step"` applies to a single active step; other `* ` highlights carry a screen-reader label.
    const currentStep = item.accent && kind === 'steps' && accented === 1;
    if (item.accent) row.classList.add('md-accent');
    if (currentStep) row.setAttribute('aria-current', 'step');
    const cue = item.accent && !currentStep ? part('span', 'visually-hidden', ` (${strings.chat.diagram.highlighted})`, true) : null;
    if (kind === 'steps') {
      const mark = part('span', 'md-step-mark', String(index + 1), true);
      mark.setAttribute('aria-hidden', 'true');
      row.append(mark, body(item, cue));
    }
    else if (kind === 'options') row.append(body(item, cue));
    else if (kind === 'bars') {
      const track = part('span', 'md-bar-track', '');
      track.setAttribute('aria-hidden', 'true');
      const fill = part('span', 'md-bar-fill', '');
      const share = Math.round((item.share ?? 0) * 1000) / 10;
      fill.style.setProperty('--share', `${share}%`);
      // A value too small to see keeps a sliver; a zero stays an empty track.
      if (!item.share) fill.classList.add('md-bar-zero');
      track.append(fill);
      const value = part('span', 'md-bar-value', item.value ?? '', true);
      // The value column stops at `VALUE_CH`, cut with an ellipsis; the whole value stays in its tooltip.
      if ((item.value?.length ?? 0) > VALUE_CH) value.title = item.value!;
      const label = part('span', 'md-bar-label', item.title);
      if (cue) label.append(cue);
      row.append(label, track, value);
      if (item.detail) row.append(part('span', 'md-bar-note', item.detail));
    } else {
      const label = part('dt', 'md-stat-label', item.title);
      if (cue) label.append(cue);
      row.append(label, part('dd', 'md-stat-value', item.value ?? ''));
      if (item.detail) row.append(part('dd', 'md-stat-detail', item.detail));
    }
    list.append(row);
  }
  return list;
}

function body(item: NativeItem, cue: HTMLElement | null): HTMLElement {
  const wrap = part('span', 'md-native-body', '');
  const title = part('span', 'md-native-title', item.title);
  if (cue) title.append(cue);
  wrap.append(title);
  if (item.detail) wrap.append(part('span', 'md-native-detail', item.detail));
  return wrap;
}

/** An element holding `text` as escaped inline Markdown, or as plain text when `plain`. */
function part(tag: string, className: string, text: string, plain = false): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  if (plain) element.textContent = text;
  else if (text) {
    element.innerHTML = inline(text, false);
    // Formulas inside a block's inline fields stay inline instead of claiming a 48px display box.
    for (const math of element.querySelectorAll('.md-math[data-display]')) math.removeAttribute('data-display');
  }
  return element;
}
