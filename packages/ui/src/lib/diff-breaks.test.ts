import { expect, test } from 'vitest';
import { breakAfterOperators, escapeCode } from './diff-breaks';

// A wrap never breaks inside a token ("i +=" over "500"), so a phone's diff can wrap.
test('a line may break after the last operator of a run, before the code that follows', () => {
  expect(breakAfterOperators('total+=500;')).toBe('total+=<wbr>500;');
  expect(breakAfterOperators('a.b(c,d)')).toBe('a.<wbr>b(<wbr>c,<wbr>d)');
  // A space already breaks, and the line's end needs nothing.
  expect(breakAfterOperators('i += 1')).toBe('i += 1');
});

test('never inside a tag or an entity, and an entity counts as its character', () => {
  expect(breakAfterOperators('<span class="k">if</span> (a&lt;b)')).toBe('<span class="k">if</span> (<wbr>a&lt;b)');
  expect(breakAfterOperators('x=<mark class="word">y</mark>')).toBe('x=<mark class="word"><wbr>y</mark>');
  expect(breakAfterOperators('a&amp;&amp;b')).toBe('a&amp;&amp;<wbr>b');
  // A tag's opening stays with its name: `</` then `p>` on the next line read as broken markup.
  expect(breakAfterOperators('x}&lt;/p&gt;')).toBe('x}&lt;/p&gt;');
  expect(breakAfterOperators('a=&lt;b')).toBe('a=&lt;b');
});

test('a plain line is escaped before it is drawn as markup', () => {
  expect(escapeCode('a < b && "c" > d')).toBe('a &lt; b &amp;&amp; "c" &gt; d');
});
