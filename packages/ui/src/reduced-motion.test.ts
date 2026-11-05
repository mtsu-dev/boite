import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

const SRC = resolve('src');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

test('every endless animation stops when the system asks for reduced motion', () => {
  const unguarded = svelteFiles(SRC).filter((path) => {
    const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(readFileSync(path, 'utf8'))?.[1] ?? '';
    return /\binfinite\b/.test(style) && !/prefers-reduced-motion:\s*reduce/.test(style);
  });
  expect(unguarded.map((path) => path.slice(SRC.length + 1))).toEqual([]);
});

test('app.css times every animation and transition with a token that reduced motion drops', () => {
  const css = readFileSync(join(SRC, 'app.css'), 'utf8');
  // A literal duration on a declaration escapes the reduced-motion tokens: the phone sheet's 240 ms did.
  const literal = [...css.matchAll(/(?:animation|transition)-duration:\s*([^;}]+)/g)].map(match => match[1]!.trim()).filter(value => !value.startsWith('var('));
  expect(literal).toEqual([]);
  const blocks = [/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/, /html\[data-motion='reduced'\] \{([^}]*)\}/].map(rule => rule.exec(css)?.[1] ?? '');
  for (const block of blocks) for (const token of ['--dur-sheet', '--dur-sheet-out']) expect(block).toMatch(new RegExp(`${token}:\\s*0\\.01ms`));
  expect(css).toMatch(/\[data-mobile-sheet='true'\] \{[^}]*animation-duration: var\(--dur-sheet\)/);
  expect(css).toMatch(/\[data-mobile-sheet='true'\]\.closing \{[^}]*animation-duration: var\(--dur-sheet-out\)/);
});
