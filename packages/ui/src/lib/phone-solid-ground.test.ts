import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve('src/app.css'), 'utf8');

/**
 * Round 7: a phone in solid light painted its page #FDFDFE under #FFF cells, so the filter band
 * and the grouped lists vanished (1.01:1) while the three other poses showed them. The phone
 * page now sinks to a mix of the frame grey and the cells' white; this reads that mix from
 * `app.css` and checks the cells stand on it and the text and status tiers still read.
 */

const light = (() => {
  const start = css.indexOf("[data-theme='light'] {");
  return css.slice(start, css.indexOf('}', start));
})();
const hex = (name: string) => {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(light);
  if (!match?.[1]) throw new Error(`no hex ${name} in the light theme`);
  return match[1];
};
const rgb = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
const luminance = (channels: number[]) => {
  const [r, g, b] = channels.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('a phone in solid light puts its page on a sunken grey the white cells and the band stand on', () => {
  const phone = /@media \(max-width: 720px\) \{\s*:root\[data-panes='solid'\]\[data-theme='light'\] \{ --color-background: var\(--color-surface\); \}\s*@supports[^{]*\{\s*:root\[data-panes='solid'\]\[data-theme='light'\] \{ --color-background: color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\); \}/.exec(css);
  expect(phone, 'the phone solid-light page ground in app.css').not.toBeNull();
  const [, from, share, to] = phone!;
  const a = rgb(hex(from!)), b = rgb(hex(to!));
  const page = a.map((v, i) => v * Number(share) / 100 + b[i]! * (1 - Number(share) / 100));
  const cell = rgb(hex('--color-surface-2'));
  // The old page against its cells read 1.01:1; iOS grouped lists (#F2F2F7 under white) stand at 1.12:1.
  expect(ratio(cell, page)).toBeGreaterThanOrEqual(1.1);
  expect(ratio(cell, rgb(hex('--color-surface')))).toBeGreaterThanOrEqual(1.05);
  for (const tier of ['--color-foreground', '--color-muted-foreground', '--color-subtle', '--color-meta', '--color-live', '--color-success', '--color-danger'])
    expect(ratio(rgb(hex(tier)), page), `${tier} on the phone page`).toBeGreaterThanOrEqual(4.5);
});
