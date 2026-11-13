import { expect, test } from 'vitest';
import { diffRows } from './diff';
import { changedWords, markHtml, markText, wordMarks } from './diff-words';

const marked = (text: string, ranges: readonly (readonly [number, number])[]) => ranges.map(([start, end]) => text.slice(start, end));

test('a changed line marks the words that changed on each side, and nothing else', () => {
  const words = changedWords('const limit = 3;', 'const limit = 30;')!;
  expect(marked('const limit = 3;', words.before)).toEqual(['3']);
  expect(marked('const limit = 30;', words.after)).toEqual(['30']);
  const renamed = changedWords('  upload(file, token);', '  upload(file, session, token);')!;
  expect(renamed.before).toEqual([]);
  expect(marked('  upload(file, session, token);', renamed.after)).toEqual(['session,']);
});

test('a rewritten, identical or very long line gets no marks', () => {
  expect(changedWords('return a + b;', 'throw new Error("no");')).toBeNull();
  expect(changedWords('same', 'same')).toBeNull();
  expect(changedWords('x'.repeat(500), 'y'.repeat(500))).toBeNull();
});

test('the drawn rows pair each removed line with the added line in its place', () => {
  const rows = diffRows('a\nlet size = 1;\nlet name = "x";\nz\n', 'a\nlet size = 2;\nlet name = "y";\nnew line\nz\n');
  const marks = wordMarks(rows);
  const text = (kind: string) => rows.filter(row => row.kind === kind && marks.has(row)).map(row => 'text' in row ? marked(row.text, marks.get(row)!) : []);
  expect(text('remove')).toEqual([['1'], ['x']]);
  expect(text('add')).toEqual([['2'], ['y']]);
  // The added line with no removed partner is new as a whole.
  expect(rows.some(row => row.kind === 'add' && row.text === 'new line' && marks.has(row))).toBe(false);
});

test('marks lay over highlighted html without breaking its spans, an entity counted as one character', () => {
  const html = '<span class="k">if</span> (a &lt; <span class="n">10</span>)';
  // The text is "if (a < 10)": mark "< 10".
  expect(markHtml(html, [[6, 10]])).toBe('<span class="k">if</span> (a <mark class="word">&lt; </mark><span class="n"><mark class="word">10</mark></span>)');
  expect(markText('if (a < 10)', [[6, 10]])).toEqual([{ text: 'if (a ', marked: false }, { text: '< 10', marked: true }, { text: ')', marked: false }]);
});
