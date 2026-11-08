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

// app.css cuts every transition to 0.01ms under reduced motion, and an element with
// no transition of its own takes `all`: Chrome paints a new transition's first frame
// at the old value, so whatever a script places would trail a frame behind.
test('every element placed from script names its own transition, so reduced motion does not slide it', () => {
  const unnamed = svelteFiles(SRC).flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(text)?.[1] ?? '';
    const markup = text.replace(/<style[^>]*>[\s\S]*?<\/style>/, '');
    return [...markup.matchAll(/<[a-z][\w-]*\b((?:[^>"']|"[^"]*"|'[^']*'|\{[^}]*\})*?)\bstyle:(?:top|left|transform)=/g)].flatMap((tag) => {
      const name = /\bclass="([\w-]+)/.exec(tag[1] ?? '')?.[1];
      const named = name !== undefined && new RegExp(`\\.${name}\\b[^{}]*\\{[^}]*\\btransition(?:-property)?\\s*:`).test(style);
      return named ? [] : [`${path.slice(SRC.length + 1)} ${name ?? '(no class)'}`];
    });
  });
  expect(unnamed).toEqual([]);
});
