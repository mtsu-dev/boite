import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { appCss } from './test/app-css';

/** The source without its comments, which may name a selector. */
const bare = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (path: string) => bare(readFileSync(resolve('src', path), 'utf8'));

/** The at-rule preludes around `at`, innermost first: what a rule there waits for. */
function around(css: string, at: number): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (css[i] === '}') depth++;
    else if (css[i] === '{') {
      if (depth > 0) { depth--; continue; }
      const start = Math.max(css.lastIndexOf('}', i), css.lastIndexOf(';', i)) + 1;
      out.push(css.slice(start, i).trim());
    }
  }
  return out;
}

/** Every selector list containing `pattern`, with what it waits for. */
function rules(css: string, pattern: RegExp): { selector: string; within: string[] }[] {
  return [...css.matchAll(new RegExp(`[^{};]*${pattern.source}[^{};]*\\{`, 'g'))].map((match) => ({
    selector: match[0].slice(0, -1).trim(),
    within: around(css, match.index! + match[0].length - 1)
  }));
}

test("the shared chip is `.ui-chip`: a component's own `.chip` class is never styled by app.css", () => {
  expect(rules(bare(appCss()), /\.chip\b/).map((rule) => rule.selector)).toEqual([]);
  expect(rules(bare(appCss()), /\.ui-chip\b/).length).toBeGreaterThan(0);
});

test("a tap leaves the composer quiet: its hairline brightens under a fine pointer or after a key, as its ring does", () => {
  const found = rules(bare(appCss()), /\.composer:focus-within/).concat(rules(bare(appCss()), /\.composer\.keys:focus-within/));
  expect(found.length).toBe(2);
  for (const rule of found) expect(rule.selector.includes('.keys') || rule.within.some((media) => /hover:\s*hover/.test(media) && /pointer:\s*fine/.test(media))).toBe(true);
});

test('the composer chip fills under a pointer that hovers only: a finger leaves it unpressed', () => {
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(read('components/ComposerBar.svelte'))![1]!;
  const hovers = rules(style, /\.trigger:hover/);
  expect(hovers.length).toBeGreaterThan(0);
  for (const rule of hovers) expect(rule.within.some((media) => /hover:\s*hover/.test(media))).toBe(true);
});

test("the phone model search is a 44 px field the input fills: its hairline is drawn inside, so no border eats the target", () => {
  expect(read('components/ModelSearch.svelte')).toMatch(/<SearchField\b[^>]*\bcompact\b/);
  const css = read('components/SearchField.svelte');
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
  expect(phone).toMatch(/\.compact \{ height: var\(--touch-target\); border: 0; box-shadow: inset/);
  expect(bare(appCss())).toMatch(/--touch-target: 44px;/);
  expect(css).toMatch(/\binput \{[^}]*height: 100%;/);
});
