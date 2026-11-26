import { expect, test } from 'vitest';
import { renderMarkdown } from './markdown';
import { ParagraphScan, paragraphBlocks, pendingDrawing, visibleAnswer } from './message-display';

const PIECES = ['word ', 'two words ', '\n', '\n\n', '\r\n', '\r\n\r\n', '```', '```ts\n', '~~~', '````\n', '  ', '\t', '[BOITE_GOAL_COMPLETE]', '[BOITE_GOAL_', 'x'];

function randomText(seed: number, length: number): string {
  let state = seed;
  const next = (limit: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % limit;
  };
  let text = '';
  while (text.length < length) text += PIECES[next(PIECES.length)];
  return text;
}

test('a streamed text splits into the same blocks as a scan of the whole text', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const text = randomText(seed, 400);
    const scan = new ParagraphScan();
    for (let end = 0; end <= text.length; end += 1 + (seed % 7)) {
      const shown = visibleAnswer(text.slice(0, end));
      expect(scan.blocks(shown, true)).toEqual(paragraphBlocks(shown, true));
    }
    const final = visibleAnswer(text);
    expect(scan.blocks(final, false)).toEqual(paragraphBlocks(final, false));
  }
});

test('an edited or shortened text starts the scan over', () => {
  const scan = new ParagraphScan();
  expect(scan.blocks('one\n\ntwo\n\nthree', true)).toEqual(['one', 'two']);
  expect(scan.blocks('uno\n\ntwo\n\n', true)).toEqual(['uno', 'two']);
  expect(scan.blocks('uno\n', true)).toEqual([]);
  expect(scan.blocks('```\na\n\nb', true)).toEqual([]);
  expect(scan.blocks('```\na\n\nb\n```\n\nc', false)).toEqual(['```\na\n\nb\n```', 'c']);
});

test('a delta inside a paragraph returns the same blocks, so nothing downstream re-renders', () => {
  const scan = new ParagraphScan();
  let text = 'First paragraph.\n\n';
  const first = scan.blocks(text, true);
  for (const word of 'the second one grows word by word'.split(' ')) {
    text += `${word} `;
    expect(scan.blocks(text, true)).toBe(first);
  }
  text += '\n\n';
  expect(scan.blocks(text, true)).toEqual(['First paragraph.', 'the second one grows word by word']);
});

test('a marker check looks at the last line only and keeps the fenced case', () => {
  const long = 'a'.repeat(10_000);
  expect(visibleAnswer(`${long}\n[BOITE_GOAL_COMPLETE]\n\t\r\n`)).toBe(`${long}\n`);
  expect(visibleAnswer(`\`\`\`\n${long}\n[BOITE_GOAL_COMPLETE]`)).toBe(`\`\`\`\n${long}\n[BOITE_GOAL_COMPLETE]`);
  expect(visibleAnswer(`${long}\n[BOITE_GOAL_COMPLETE] and more`)).toBe(`${long}\n[BOITE_GOAL_COMPLETE] and more`);
  expect(visibleAnswer(`${long}\n  [BOITE_GOAL_BLOCKED]\f`)).toBe(`${long}\n`);
});

test('a paragraph being written stops where a diagram, a formula or a view opens, outside another fence', () => {
  expect(pendingDrawing('Here it is:\n```view\n<svg viewBox="0 0 10')).toEqual({ text: 'Here it is:', drawing: true });
  expect(pendingDrawing('```mermaid\nflowchart LR\n  A --> B\n```')).toEqual({ text: '', drawing: true });
  expect(pendingDrawing('So\n$$\n\\int_0^1')).toEqual({ text: 'So', drawing: true });
  expect(pendingDrawing('So \\[x')).toEqual({ text: 'So \\[x', drawing: false });
  // A fence shown as code stays code until a matching closing line.
  expect(pendingDrawing('```html\n<p>Hi</p>')).toEqual({ text: '```html\n<p>Hi</p>', drawing: false });
  expect(pendingDrawing('```md\nquoted\n```view\n<p>')).toEqual({ text: '```md\nquoted\n```view\n<p>', drawing: false });
  expect(pendingDrawing('```md\nquoted\n```\n```view\n<p>')).toEqual({ text: '```md\nquoted\n```', drawing: true });
  // The shared fence grammar accepts up to three spaces, tilde fences and longer runs.
  expect(pendingDrawing('Steps:\n   ```view\n<p>')).toEqual({ text: 'Steps:', drawing: true });
  expect(renderMarkdown('   ```view\n<p>Hi</p>\n   ```')).toContain('md-view');
  for (const fence of ['~~~view', '````view', '```view title']) {
    expect(pendingDrawing(`Here:\n${fence}\n<p>`)).toEqual({ text: 'Here:', drawing: true });
  }
  const quotedCode = '````md\n```\n~~~view\n<p>';
  expect(pendingDrawing(quotedCode)).toEqual({ text: quotedCode, drawing: false });
  const indented = '    ```view\n<p>';
  const scan = new ParagraphScan();
  scan.blocks(indented, true);
  expect(pendingDrawing(scan.pending(indented))).toEqual({ text: indented, drawing: false });
  expect(pendingDrawing('```Mermaid\nflowchart LR')).toEqual({ text: '', drawing: true });
  expect(renderMarkdown('```Mermaid\nflowchart LR\n```')).toContain('md-mermaid');
  // Native blocks draw in rich rendering only; elsewhere (reasoning, plain prose) they stay code as they stream.
  for (const kind of ['steps', 'options', 'bars', 'stats']) {
    const draft = `Plan:\n\`\`\`${kind}\n* One | first`;
    expect(pendingDrawing(draft, true)).toEqual({ text: 'Plan:', drawing: true });
    expect(pendingDrawing(draft)).toEqual({ text: draft, drawing: false });
  }
  const native = 'Plan:\n```bars\nA | 2 s\n';
  const rich = new ParagraphScan();
  rich.blocks(native, true);
  expect(rich.drafting(native)).toEqual({ text: native.trimEnd(), drawing: false });
  // The completed lines are read again when the rendering turns rich, and back.
  expect(rich.drafting(native, true)).toEqual({ text: 'Plan:', drawing: true });
  expect(rich.drafting(native)).toEqual({ text: native.trimEnd(), drawing: false });
  // A quote is drawn as a document of its own, so a view opened in it is held back from its first line.
  expect(pendingDrawing('Look:\n> Here:\n> ```view\n> <svg')).toEqual({ text: 'Look:\n> Here:', drawing: true });
  expect(renderMarkdown('> ```view\n> <p>Hi</p>\n> ```')).toContain('md-view');
  // An indented fence under an open list item continues the item in `renderMarkdown`, so streaming holds nothing back
  // and `ParagraphScan.blocks` still flushes the list at the blank line instead of trapping following paragraphs.
  const underItem = '- item\n  ```bars\n  A | 1 s\n  ```';
  expect(pendingDrawing(underItem, true)).toEqual({ text: underItem, drawing: false });
  expect(renderMarkdown(underItem, true)).not.toContain('md-native');
  const liveList = new ParagraphScan();
  const streamed = '- item\n  ```steps\n  1. First\n\nFollowing paragraph\n\nNext';
  expect(liveList.blocks(streamed, true)).toEqual(['- item\n  ```steps\n  1. First', 'Following paragraph']);
  expect(liveList.drafting(streamed, true)).toEqual({ text: 'Next', drawing: false });
});