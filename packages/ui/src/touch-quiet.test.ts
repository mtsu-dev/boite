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
  const css = read('components/ModelSearch.svelte');
  const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
  expect(phone).toMatch(/\.search \{ height: var\(--touch-target\); border: 0;/);
  expect(bare(appCss())).toMatch(/--touch-target: 44px;/);
  expect(css).toMatch(/\.search input \{[^}]*height: 100%;/);
});

test("the rail's Add shows only under a pointer on the rail, fading as the edge scrollbars do; a touch screen and high contrast always show it", () => {
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(read('components/AppRail.svelte'))![1]!;
  const body = (selector: string) => style.slice(style.indexOf(selector) + selector.length).match(/^\s*\{([^}]*)\}/)![1]!;
  const tucked = rules(style, /\.rail-button\.add\.tucked/);
  // Its own class, which app.css leaves alone: the shared `.quiet` button resized its glyph from 19 to 16 px.
  expect(bare(appCss())).not.toMatch(/\.tucked\b/);
  const hidden = tucked.filter((rule) => /opacity:\s*0\s*;/.test(body(rule.selector)));
  expect(hidden.length).toBe(1);
  // Out of sight only where a pointer can come to the rail: without hover nothing would ever bring it back.
  // High contrast shows it too, as it keeps the native scrollbars.
  for (const rule of tucked) expect(rule.within.some((media) => /hover:\s*hover/.test(media) && /pointer:\s*fine/.test(media) && /forced-colors:\s*none/.test(media))).toBe(true);
  // Hidden by its opacity, never taken out of the tree: it keeps its name for a screen reader.
  expect(body(hidden[0]!.selector)).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  expect(style).not.toMatch(/\.add\.tucked[^{]*\{[^}]*(display:\s*none|visibility:\s*hidden)/);
  // The pointer over the rail, the keyboard in it or the menu it opened bring it back.
  const shown = tucked.find((rule) => /opacity:\s*1\s*;/.test(body(rule.selector)))!.selector;
  expect(shown).toMatch(/\.app-rail:hover \.rail-button\.add\.tucked/);
  expect(shown).toMatch(/\.app-rail:has\(:global\(:focus-visible\)\) \.rail-button\.add\.tucked/);
  expect(shown).toMatch(/\.rail-button\.add\.tucked\[aria-expanded='true'\]/);
  // The scrollbars' thumbs' duration and curve, which reduced motion cuts (motion.css).
  const thumb = /\.edge-scrollbar-thumb \{[^}]*transition:[^;]*?(var\(--dur-\d\)) (var\(--ease-[\w-]+\))/.exec(bare(appCss()))!;
  expect(body(hidden[0]!.selector)).toContain(`opacity ${thumb[1]} ${thumb[2]}`);
});

test("hidden, the rail's Add gives its room to the mochis: its slot takes back its height and the rail's gap, where and while Add is hidden", () => {
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(read('components/AppRail.svelte'))![1]!;
  const body = (selector: string) => style.slice(style.indexOf(selector) + selector.length).match(/^\s*\{([^}]*)\}/)![1]!;
  const slot = rules(style, /\.slot\.tucked/);
  expect(slot.length).toBe(2);
  // Under Add's own gate: a touch screen and high contrast always show Add, which keeps its room there.
  for (const rule of slot) expect(rule.within.some((media) => /hover:\s*hover/.test(media) && /pointer:\s*fine/.test(media) && /forced-colors:\s*none/.test(media))).toBe(true);
  // What Add holds in the rail's column: a button's height and the gap the rail lays under it. A rail too short
  // for its mochis shows them there instead of cutting them above an empty place.
  const folded = slot.find((rule) => /margin-bottom:\s*calc\(/.test(body(rule.selector)))!.selector;
  expect(folded).toBe('.slot.tucked');
  expect(body(folded)).toContain('margin-bottom: calc(-1 * var(--rail-button) - 8px);');
  expect(style).toMatch(/\.app-rail \{[^}]*flex-direction: column;[^}]*gap: 8px;/);
  expect(style).toMatch(/\.rail-button, \.bot \{[^}]*height: var\(--rail-button\);/);
  // By its margin alone: the slot keeps its size, so Add fades where it stands when the rail has room, and stays in the tree.
  expect(body(folded)).not.toMatch(/(^|[\s;])height:|display:\s*none|visibility:\s*hidden/);
  // Given back by what shows Add: the pointer over the rail, the keyboard in it or the menu Add opened.
  const open = slot.find((rule) => /margin-bottom:\s*0\s*;/.test(body(rule.selector)))!.selector;
  expect(open).toMatch(/\.app-rail:hover \.slot\.tucked/);
  expect(open).toMatch(/\.app-rail:has\(:global\(:focus-visible\)\) \.slot\.tucked/);
  expect(open).toMatch(/\.slot\.tucked:has\(\.rail-button\.add\[aria-expanded='true'\]\)/);
  // On Add's own duration and curve, which reduced motion cuts (motion.css).
  const thumb = /\.edge-scrollbar-thumb \{[^}]*transition:[^;]*?(var\(--dur-\d\)) (var\(--ease-[\w-]+\))/.exec(bare(appCss()))!;
  expect(body(folded)).toContain(`transition: margin-bottom ${thumb[1]} ${thumb[2]};`);
});
