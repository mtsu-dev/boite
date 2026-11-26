import { expect, test } from 'vitest';
import { drawNative, MAX_ITEMS, parseNative, readValue } from './native-blocks';

test('steps and options read a title, a detail, a list mark and a highlight; an escaped pipe stays in its field', () => {
  expect(parseNative('steps', '1. Install | `bun install`\n\n* 2) Build\n- Ship a\\|b | now')).toEqual([
    { accent: false, title: 'Install', detail: '`bun install`' },
    { accent: true, title: 'Build' },
    { accent: false, title: 'Ship a|b', detail: 'now' }
  ]);
  // `**` opens bold, not a highlight.
  expect(parseNative('options', '**Keep** | as is\n* Rewrite')).toEqual([
    { accent: false, title: '**Keep**', detail: 'as is' },
    { accent: true, title: 'Rewrite' }
  ]);
});

test('bars compare across time, byte, bit, currency and magnitude units, and percentages scale against 100', () => {
  const shares = (source: string) => parseNative('bars', source)?.map(item => item.share);
  expect(shares('Cold | 4.2 s\n* Warm | 800 ms | cached')).toEqual([1, 0.8 / 4.2]);
  // Both micro sign (U+00B5) and Greek small mu (U+03BC) belong to time.
  expect(shares('Fast | 50 μs\nSlow | 1 ms')).toEqual([(50 * 1e-6) / 1e-3, 1]);
  expect(shares('A | 3.4 MB\nB | 850 KB')).toEqual([1, 0.85e6 / 3.4e6]);
  // Bits and bytes preserve their 1:8 ratio (`10 Mb` is 1.25 MB).
  expect(shares('A | 10 Mb\nB | 10 MB')).toEqual([0.125, 1]);
  expect(shares('A | 12k\nB | 1,250\nC | 4.2')).toEqual([1, 1250 / 12000, 4.2 / 12000]);
  // French decimal commas: leading-zero 3-digit values (`0,750`, `0,125`) are decimals, and `1,500` follows them.
  expect(shares('A | 0,750 s\nB | 1,500 s\nC | 2,5 s')).toEqual([0.75 / 2.5, 1.5 / 2.5, 1]);
  expect(shares('A | 0,125 s\nB | 0,50 s')).toEqual([0.25, 1]);
  // Mixing decimal commas with dot decimals or English thousands stays code rather than guessing.
  expect(shares('A | 2,5 s\nB | 4.2 s')).toBeUndefined();
  expect(shares('A | 2,5 s\nB | 1,250.5 s')).toBeUndefined();
  expect(shares('A | 2,5\nB | 1,000,000')).toBeUndefined();
  // Space-grouped thousands (`1 250`) work with plain units and currencies.
  expect(shares('A | 1 250 ms\nB | 2,5 s')).toEqual([0.5, 1]);
  expect(shares('A | 120 €\nB | €60\nC | 1,2k €')).toEqual([120 / 1200, 60 / 1200, 1]);
  expect(shares('A | $1.2M\nB | $300k')).toEqual([1, 0.25]);
  expect(shares('A | $120/mo\nB | 60 $/mo')).toEqual([1, 0.5]);
  expect(shares('A | 120 €\nB | $80')).toBeUndefined();
  // Lowercase `m` stays meters, never colliding with `M` (millions) or bare counts.
  expect(shares('A | 5 m\nB | 500')).toBeUndefined();
  expect(shares('A | 5 m\nB | 10 m')).toEqual([0.5, 1]);
  expect(shares('A | 5 M\nB | 500k')).toEqual([1, 0.1]);
  expect(shares('A | 84%\nB | 42%')).toEqual([0.84, 0.42]);
  expect(shares('A | 150%\nB | 75%')).toEqual([1, 0.5]);
  // A unit with no family compares with itself only.
  expect(shares('A | 120 fps\nB | 60 fps')).toEqual([1, 0.5]);
  expect(readValue('-3 ms')).toBeNull();
  // A zero bar is an empty track, not a sliver.
  const zero = drawNative('bars', parseNative('bars', 'A | 0 ms\nB | 0.01 ms\nC | 10 s')!);
  expect([...zero.querySelectorAll('.md-bar-fill')].map(fill => fill.classList.contains('md-bar-zero'))).toEqual([true, false, false]);
  expect(zero.style.getPropertyValue('--md-bar-value')).toBe('7ch');
});

test('a value reads only when the whole field is a number and an optional unit', () => {
  expect(readValue('12,500.5 s')).toEqual({ family: 'time', amount: 12500.5 });
  expect(readValue('4,25')).toEqual({ family: 'count', amount: 4.25 });
  expect(readValue('0,125 s')).toEqual({ family: 'time', amount: 0.125 });
  expect(readValue('1 250 ms')).toEqual({ family: 'time', amount: 1.25 });
  expect(readValue('120 €')).toEqual({ family: 'currency:€', amount: 120 });
  expect(readValue('€120')).toEqual({ family: 'currency:€', amount: 120 });
  expect(readValue('120 req/s')).toEqual({ family: 'unit:req/s', amount: 120 });
  // Grouping is three digits after a group of one to three; an underscore or mixed currency+unit is no unit.
  for (const text of ['1234,567', '12,34,567', '1,2345,678', '1_345', '1_345 ms', '1.2.3', '4,2,5', '$120 €', '$120 ms']) expect(readValue(text), text).toBeNull();
  // A unit named like an Object property is a unit of its own, not a lookup into the prototype.
  expect(readValue('5 constructor')).toEqual({ family: 'unit:constructor', amount: 5 });
  expect(readValue('5 __proto__')).toBeNull();
  expect(readValue('5 toString')).toEqual({ family: 'unit:toString', amount: 5 });
  // A number past the double range, or one its unit pushes there, is not a measure.
  expect(readValue('9'.repeat(400))).toBeNull();
  expect(readValue(`1${'0'.repeat(300)} TiB`)).toBeNull();
  expect(parseNative('bars', `A | 1${'0'.repeat(300)} TiB\nB | 1 TiB`)).toBeNull();
  expect(parseNative('bars', 'A | 0 ms\nB | 0 s')?.map(item => item.share)).toEqual([0, 0]);
  // A long field that is no value is refused in linear time, not after backtracking over it.
  const started = performance.now();
  // The unit pattern this replaced took 330 ms on the first one (2026-11-25).
  // A line separator ends `.`, so spaces before it once backtracked too.
  for (const text of [`1 m${'/'.repeat(20000)}1`, `1 m${'/'.repeat(5000)}!`, `${'9'.repeat(20000)}!`, `1 a${' a'.repeat(20000)}1`, `1${' '.repeat(20000)}a\u2028b`, `1${' 000'.repeat(5000)}!`]) expect(readValue(text)).toBeNull();
  expect(performance.now() - started).toBeLessThan(50);
});

test('a long value is drawn at most 14 characters wide, whole in its tooltip', () => {
  const long = '1'.repeat(120);
  const bars = drawNative('bars', parseNative('bars', `A | ${long}\nB | 2`)!);
  expect(bars.style.getPropertyValue('--md-bar-value')).toBe('14ch');
  expect([...bars.querySelectorAll<HTMLElement>('.md-bar-value')].map(value => value.title)).toEqual([long, '']);
});

test('a backslash escapes the next character, so only an odd run of them keeps a pipe in its field', () => {
  expect(parseNative('options', 'C:\\\\| root')).toEqual([{ accent: false, title: 'C:\\\\', detail: 'root' }]);
  expect(parseNative('options', 'a\\\\\\| b')).toEqual([{ accent: false, title: 'a\\\\| b' }]);
  expect(parseNative('options', 'a\\*b | trailing \\')).toEqual([{ accent: false, title: 'a\\*b', detail: 'trailing \\' }]);
  // The inline renderer reads the doubled backslash as one.
  expect(drawNative('options', parseNative('options', 'C:\\\\| root')!).querySelector('.md-native-title')!.textContent).toBe('C:\\');
});

test('a block that does not fit its grammar is not drawn', () => {
  expect(parseNative('steps', '\n  \n')).toBeNull();
  expect(parseNative('steps', Array.from({ length: MAX_ITEMS }, (_, index) => `Step ${index}`).join('\n'))).toHaveLength(MAX_ITEMS);
  expect(parseNative('steps', Array.from({ length: MAX_ITEMS + 1 }, (_, index) => `Step ${index}`).join('\n'))).toBeNull();
  expect(parseNative('options', 'A | b | c')).toBeNull();
  expect(parseNative('options', '| no title')).toBeNull();
  expect(parseNative('bars', 'A | fast\nB | 2 s')).toBeNull();
  expect(parseNative('bars', 'A | 2 s\nB | 3 MB')).toBeNull();
  expect(parseNative('bars', 'A | 2 s\nB')).toBeNull();
  expect(parseNative('stats', 'Users | 1,204\nUptime')).toBeNull();
  expect(parseNative('stats', 'Users |  | up')).toBeNull();
  expect(parseNative('stats', 'Users | 1,204 | +3% | extra')).toBeNull();
});

test('a field is escaped inline Markdown: no markup from the source runs, loads or links to script', () => {
  const trap = '<img src=x onerror=alert(1)><script>alert(2)</script> [go](javascript:alert(3)) **bold** `code`';
  for (const kind of ['steps', 'options', 'stats'] as const) {
    const items = parseNative(kind, kind === 'stats' ? `${trap} | 1 | ${trap}` : `* ${trap} | ${trap}`)!;
    const drawn = drawNative(kind, items);
    expect(drawn.querySelector('img, script, a, [onerror]'), kind).toBeNull();
    expect(drawn.textContent).toContain('<img src=x onerror=alert(1)><script>alert(2)</script>');
    expect(drawn.querySelector('strong')?.textContent).toBe('bold');
    expect(drawn.querySelector('code')?.textContent).toBe('code');
  }
  const bars = drawNative('bars', parseNative('bars', `${trap} | 5 ms | ${trap}\nB | 10 ms`)!);
  expect(bars.querySelector('img, script, a')).toBeNull();
  expect(bars.querySelector<HTMLElement>('.md-bar-fill')!.style.getPropertyValue('--share')).toBe('50%');
});

test('each kind draws its own structure with list semantics, highlight ARIA and inline-only math', () => {
  const steps = drawNative('steps', parseNative('steps', 'One | $$x^2$$\n* Two | then')!);
  expect(steps.localName).toBe('ol');
  expect(steps.getAttribute('role')).toBe('list');
  expect([...steps.querySelectorAll('.md-step-mark')].map(mark => mark.textContent)).toEqual(['1', '2']);
  expect(steps.querySelector('.md-accent')?.getAttribute('aria-current')).toBe('step');
  expect(steps.querySelector('.md-accent .md-native-detail')?.textContent).toBe('then');
  // Display math inside an inline field stays inline (no data-display block box).
  expect(steps.querySelector('.md-math')?.hasAttribute('data-display')).toBe(false);
  const bars = drawNative('bars', parseNative('bars', '* Fast | 1 s\nSlow | 2 s')!);
  expect(bars.getAttribute('role')).toBe('list');
  expect(bars.querySelector('.md-accent')?.getAttribute('aria-current')).toBe('true');
  expect(bars.querySelector('.md-bar-track')?.getAttribute('aria-hidden')).toBe('true');
  const stats = drawNative('stats', parseNative('stats', 'Users | 1,204 | +3%\n* p95 | 180 ms')!);
  expect(stats.localName).toBe('dl');
  expect(stats.getAttribute('role')).toBeNull();
  expect([...stats.querySelectorAll('dt')].map(term => term.textContent)).toEqual(['Users', 'p95']);
  expect(stats.querySelector('.md-accent')?.getAttribute('aria-current')).toBe('true');
  expect(stats.querySelector('.md-accent .md-stat-value')?.textContent).toBe('180 ms');
  expect(stats.classList.contains('md-has-accent')).toBe(true);
});
