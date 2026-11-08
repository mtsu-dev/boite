import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const css = readFileSync(resolve('src/app.css'), 'utf8');

/**
 * The text tiers of `app.css` against every ground they sit on, in both
 * themes. The subtle tier carries paths, timestamps and hints, so it is text
 * and has to clear WCAG AA (4.5:1) on the raised surface-3 too; the muted tier
 * stays a visible step above it.
 */

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`app.css has no ${selector} block`);
  return css.slice(start, css.indexOf('}', start));
}

function token(scope: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(scope);
  if (!match?.[1]) throw new Error(`no hex ${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const GROUNDS = ['--color-background', '--color-frame', '--color-surface', '--color-surface-2', '--color-surface-3'];

describe.each([
  ['dark', ':root'],
  ['light', "[data-theme='light']"]
])('%s theme', (_theme, selector) => {
  const scope = block(selector);

  test.each(['--color-subtle', '--color-muted-foreground'])('%s clears 4.5:1 on every ground', (tier) => {
    for (const ground of GROUNDS) expect(ratio(token(scope, tier), token(scope, ground)), `${tier} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  test('muted stays a visible step above subtle', () => {
    expect(ratio(token(scope, '--color-muted-foreground'), token(scope, '--color-subtle'))).toBeGreaterThanOrEqual(1.25);
  });
});

/**
 * The floor in the components: informational text (timestamps, machine
 * names, meta, diff context, setting descriptions) takes a text token at
 * `--color-subtle` or brighter, never a fade of one. Faint is for disabled
 * text and placeholders only, and a rule that colours text does not fade it
 * with opacity, which would drop it under the floor on every ground.
 */
describe('text in the components stays at or above the subtle tier', () => {
  /** The tokens text may wear: the three text tiers, the state inks and the inks of a filled chip. */
  const TEXT = new Set([
    '--color-foreground', '--color-muted-foreground', '--color-subtle', '--color-code-foreground',
    '--color-danger', '--color-live', '--color-success', '--color-accent', '--color-resident',
    '--color-accent-ink', '--color-on-danger', '--color-on-foreground', '--primary-ink', '--color-background', '--color-surface',
    // Set by a component to one of the above.
    '--tone', '--verdict', '--mark', '--tint'
  ]);
  const KEYWORDS = new Set(['inherit', 'currentColor', 'transparent']);
  /** Where a fade is no text: an idle overlay kept above the floor (0.9 of foreground), icons and bars drawn in a colour. */
  const FADES = new Set(['.pinned-quota', '.spectrum.still', '.omnibox.secure .site', "[data-ring='queued'] .track"]);
  const exempt = (selector: string) => /disabled|placeholder/.test(selector);

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(svelte|css)$/.test(entry.name) ? [path] : [];
    });
  }

  /** Each rule's selector and declarations, `@keyframes` left out. */
  function rules(path: string): { selector: string; body: string }[] {
    let text = readFileSync(path, 'utf8');
    if (path.endsWith('.svelte')) text = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1]!.trim().replace(/\s+/g, ' '), body: match[2]! }));
  }

  function allowed(value: string, selector: string): boolean {
    const plain = value.replace(/!important/, '').trim();
    if (KEYWORDS.has(plain)) return true;
    if (/transparent/.test(plain) && plain.startsWith('color-mix')) return false;
    const tokens = [...plain.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!);
    if (tokens.length === 0 || /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(plain)) return false;
    return tokens.every((name) => TEXT.has(name) || (name === '--color-faint' && exempt(selector)));
  }

  const files = sources(resolve('src'));

  test('every text colour is a text token, faint only where text is disabled or a placeholder', () => {
    const below: string[] = [];
    for (const file of files) {
      for (const { selector, body } of rules(file)) {
        for (const match of body.matchAll(/(?:^|;)\s*color:\s*([^;]+)/g)) {
          if (!allowed(match[1]!, selector)) below.push(`${relative(resolve('src'), file)}: ${selector} { color: ${match[1]!.trim()} }`);
        }
      }
    }
    expect(below).toEqual([]);
  });

  test('a rule that colours text does not fade it with opacity', () => {
    const faded: string[] = [];
    for (const file of files) {
      for (const { selector, body } of rules(file)) {
        const opacity = /(?:^|;)\s*opacity:\s*([\d.]+)/.exec(body);
        const value = Number(opacity?.[1] ?? 1);
        if (value <= 0 || value >= 1 || !/(?:^|;)\s*color:\s*(?!transparent)/.test(body) || exempt(selector) || FADES.has(selector)) continue;
        faded.push(`${relative(resolve('src'), file)}: ${selector} { opacity: ${value} }`);
      }
    }
    expect(faded).toEqual([]);
  });

  test('the scan reads the components: a faded or faint informational colour is caught', () => {
    expect(allowed('color-mix(in srgb, var(--color-foreground) 78%, transparent)', '.preview')).toBe(false);
    expect(allowed('var(--color-faint)', '.bot-section-count')).toBe(false);
    expect(allowed('var(--color-faint)', 'input::placeholder')).toBe(true);
    expect(allowed('var(--color-subtle)', '.meta')).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });
});
