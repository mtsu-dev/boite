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

/**
 * Loops that turn on purpose slower than a spinner: the dashed ring of the
 * work a thread left running turns once in 6 s (StateRing.svelte).
 */
const SLOW_TURNS = new Set(['components/StateRing.svelte']);

/**
 * A smooth spinner takes its lap from `--dur-spin` (app.css), so every one
 * turns at one speed and a change of that speed is one line. A stepped one
 * (`steps()`) keeps its literal: render-cost.test.ts checks it lands on the
 * shared 60 Hz grid. Round 6 counted eight spinners on literal `1s` and `0.9s`.
 */
test('every smooth spinner turns on the spin token', () => {
  const literal: string[] = [];
  for (const path of svelteFiles(SRC)) {
    const relative = path.slice(SRC.length + 1);
    if (SLOW_TURNS.has(relative)) continue;
    const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(readFileSync(path, 'utf8'))?.[1] ?? '';
    for (const match of style.matchAll(/animation\s*:\s*spin\s+([^;}]+)/g)) {
      const value = match[1]!;
      // A stepped loop keeps its literal; a timing from another token (a tour picture's step) is not a literal.
      if (/steps\(/.test(value) || !/^\d*\.?\d+m?s\b/.test(value.trim())) continue;
      literal.push(`${relative}: spin ${value.trim()}`);
    }
  }
  expect(literal).toEqual([]);
});
