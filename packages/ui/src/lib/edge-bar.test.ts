import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A selected row marks its edge with a 2 px accent bar. Drawn as
 * `box-shadow: inset 2px 0 0` on a row with a radius, the shadow follows the
 * corners and tapers at both ends into a "(" shape. A rounded row draws its bar
 * as a straight `::before` stroke instead; a square line (a diff or code line)
 * may keep the inset shadow, which stays straight there.
 */

const ROOT = resolve('src');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

/** The rules of a component that bend an inset edge bar around a rounded corner. */
function crescentBars(source: string): string[] {
  const open = source.indexOf('<style');
  if (open < 0) return [];
  const style = source.slice(source.indexOf('>', open) + 1).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = '', body = '']) => ({ selector: selector.trim(), body }));
  const rounded = new Set<string>();
  for (const { selector, body } of rules) {
    const radius = /border-radius:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (!radius || radius === '0' || radius === '0px') continue;
    for (const part of selector.split(',')) {
      const only = /^\.([\w-]+)$/.exec(part.trim());
      if (only?.[1]) rounded.add(only[1]);
    }
  }
  const bent: string[] = [];
  for (const { selector, body } of rules) {
    if (!/box-shadow:\s*inset\s+-?\d+px\s+0\s+0/.test(body)) continue;
    const base = /^\.([\w-]+)/.exec(selector)?.[1];
    if (base && rounded.has(base)) bent.push(selector);
  }
  return bent;
}

describe('edge bar', () => {
  test('an inset bar on a rounded row is caught', () => {
    const row = '<style>\n  .row { border-radius: var(--radius-md); }\n  .row.selected { box-shadow: inset 2px 0 0 var(--color-accent); }\n</style>';
    expect(crescentBars(row)).toEqual(['.row.selected']);
    const line = '<style>\n  .line { display: flex; }\n  .line.on { box-shadow: inset 2px 0 0 var(--color-accent); }\n</style>';
    expect(crescentBars(line)).toEqual([]);
  });

  test('no rounded row draws its edge bar as an inset shadow', () => {
    const bent: string[] = [];
    for (const file of svelteFiles(ROOT)) {
      for (const selector of crescentBars(readFileSync(file, 'utf8'))) bent.push(`${file.slice(ROOT.length + 1)} ${selector}`);
    }
    expect(bent).toEqual([]);
  });
});
