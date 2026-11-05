import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The keyboard focus ring is the global 2 px accent outline of `app.css`. A
 * component rule that sets `outline: none` on `:focus-visible` and paints only
 * the hover tint (a 5 % veil) leaves a focused menu row almost unmarked, so a
 * rule that drops the outline must draw its own: an outline, a box shadow or
 * a border colour. Rows inside scrolling menus keep the global ring with
 * `outline-offset: -2px` instead, so the scroll box does not clip it.
 */

const ROOT = resolve('src');
/** The code editor's textarea fills its pane; its caret is the focus mark, as in any editor. */
const EXEMPT = new Set(['components/FileSurface.svelte .text:focus-visible']);

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

describe('focus ring', () => {
  test('no :focus-visible rule drops the outline without drawing its own mark', () => {
    const bare: string[] = [];
    for (const file of svelteFiles(ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const [, selector = '', body = ''] of source.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
        if (!/outline:\s*none/.test(body) || /box-shadow|outline:\s*\d|border-color/.test(body)) continue;
        const name = `${file.slice(ROOT.length + 1)} ${selector.trim().replace(/\s+/g, ' ')}`;
        // A pseudo-element that draws the ring for the element counts as its mark.
        const sel = selector.trim().split(',').map((s) => s.trim()).find((s) => s.includes(':focus-visible')) ?? '';
        if (source.includes(`${sel}::after { outline:`) || source.includes(`${sel}::before { outline:`)) continue;
        if (!EXEMPT.has(name)) bare.push(name);
      }
    }
    expect(bare).toEqual([]);
  });
});
