import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  /* Amber is the user's turn, red a failure, green done: each is read as text on the card and the raised surfaces. */
  test.each(['--color-live', '--color-success', '--color-danger'])('%s reads as text on the card', (status) => {
    for (const ground of ['--color-background', '--color-surface-2']) expect(ratio(token(scope, status), token(scope, ground)), `${status} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  /* A row's time on the selected row's ground: subtle fell to 4.3:1 there in the captures, the meta tier keeps 5:1. */
  test('--color-meta clears 5:1 on a selected row', () => {
    const active = /--color-active:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(scope);
    if (!active) throw new Error('no rgba --color-active');
    const [r, g, b, a] = active.slice(1).map(Number) as [number, number, number, number];
    const over = (hex: string) => '#' + [r, g, b].map((c, i) => Math.round(c * a + parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
    for (const ground of ['--color-frame', '--color-surface-2']) expect(ratio(token(scope, '--color-meta'), over(token(scope, ground))), `--color-meta on ${ground} + --color-active`).toBeGreaterThanOrEqual(5);
    // Still a shade under the muted line it sits on.
    expect(ratio(token(scope, '--color-meta'), token(scope, '--color-frame'))).toBeLessThan(ratio(token(scope, '--color-muted-foreground'), token(scope, '--color-frame')));
  });

  test('muted stays a visible step above subtle', () => {
    expect(ratio(token(scope, '--color-muted-foreground'), token(scope, '--color-subtle'))).toBeGreaterThanOrEqual(1.25);
  });
});
