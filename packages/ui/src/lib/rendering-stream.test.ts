import { expect, test, vi } from 'vitest';
import { ParagraphScan, paragraphBlocks, pendingDrawing } from './message-display';
import { appendText, textRevision } from './text-revisions';

test('incremental drawing state follows split markers, nested quote documents and replacements', () => {
  const scan = new ParagraphScan();
  for (const text of [
    'Look:\r\n> > ```m', 'Look:\r\n> > ```mermaid', 'Look:\r\n> > \\[x\r\n',
    'Look:\r\n> > ```mermaid\r\n> > graph LR\r\n> > ```\r\n\r\nAfter',
    '> ```md\n> ```view\n> code', '> ```md\n> ```view\n> code\nplain\n```view',
    '    ```view\nsource', '  ```view\nsource',
    'Replacement\n\nplain', 'Replacement\n\nplain\n\\[x',
  ]) {
    scan.blocks(text, true);
    expect(scan.drafting(text)).toEqual(pendingDrawing(scan.pending(text)));
  }
});

test('every partial line has the same drawing and block result as a fresh scan', () => {
  for (const text of [
    ' Intro\n> ```md\n> > ```view\n> ```\n> > ~~~view title\n> > <p>\n\nEnd',
    '  ~~~Mermaid\r\ngraph LR\r\n~~~\r\n\r\nAfter\n$$\nx',
    '    ```view\n<p>\n\n> > \\[x',
  ]) {
    const scan = new ParagraphScan();
    for (let end = 0; end <= text.length; end++) {
      const part = text.slice(0, end);
      expect(scan.blocks(part, true)).toEqual(paragraphBlocks(part, true));
      expect(scan.drafting(part)).toEqual(pendingDrawing(scan.pending(part)));
    }
  }
});

test('known append epochs bypass prefix comparison but a replacement epoch resets all state', () => {
  const scan = new ParagraphScan();
  const epoch = {};
  let text = '```ts\n' + 'line\n'.repeat(1000);
  scan.blocks(text, true, epoch);
  const prefix = vi.spyOn(String.prototype, 'startsWith');
  for (let n = 0; n < 10; n++) { text += 'line\n'; scan.blocks(text, true, epoch); scan.drafting(text); }
  expect(prefix.mock.calls.filter(call => typeof call[0] === 'string' && call[0].length > 100)).toHaveLength(0);
  prefix.mockRestore();
  const replaced = text.replace('```ts', 'intro') + '\n```view';
  scan.blocks(replaced, true, {});
  expect(scan.drafting(replaced)).toEqual(pendingDrawing(scan.pending(replaced)));
  // Unknown writers must still detect edits even when the replacement is longer.
  scan.blocks('other\n\n' + replaced, true);
  expect(scan.blocks('other\n\n' + replaced, true)).toEqual(paragraphBlocks('other\n\n' + replaced, true));
});

test('append provenance survives batched deltas and invalidates longer snapshots and corrections', () => {
  const part = { text: '```ts\ncode' };
  const scan = new ParagraphScan();
  const original = textRevision(part);
  scan.blocks(part.text, true, original);
  appendText(part, '\n```\n'); appendText(part, '\nNew\n\n');
  expect(textRevision(part)).toBe(original);
  expect(scan.blocks(part.text, true, textRevision(part))).toEqual(paragraphBlocks(part.text, true));
  part.text = 'different\n\n' + part.text;
  expect(textRevision(part)).not.toBe(original);
  expect(scan.blocks(part.text, true, textRevision(part))).toEqual(paragraphBlocks(part.text, true));
  const replacement = textRevision(part);
  part.text = part.text.replace('different', 'corrected');
  appendText(part, 'next');
  expect(textRevision(part)).not.toBe(replacement);
  expect(scan.blocks(part.text, true, textRevision(part))).toEqual(paragraphBlocks(part.text, true));
  expect(textRevision({ text: part.text })).not.toBe(textRevision(part));
});
