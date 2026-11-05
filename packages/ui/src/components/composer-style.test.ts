import { expect, test } from 'vitest';
import composerSource from './Composer.svelte?raw';
import barSource from './ComposerBar.svelte?raw';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vite turns a stylesheet import into nothing under test: read the file.
const appCss = readFileSync(resolve('src/app.css'), 'utf8');

// jsdom lays nothing out, so these read the rules the browser would apply.

test('the composer is a solid card: no backdrop blur, no translucent default surface', () => {
  expect(composerSource).not.toMatch(/backdrop-filter/);
  const supports = appCss.slice(appCss.indexOf('@supports (color: color-mix(in oklab, white 50%, black))'));
  expect(supports.slice(0, supports.indexOf('}\n}'))).not.toMatch(/--color-composer-surface/);
});

test('the phone model chip is a whole capsule of fill, not the control highlight alone', () => {
  const phone = barSource.slice(barSource.indexOf('@media (max-width: 720px)'));
  const rule = phone.match(/\.chips :global\(\.picker > \.trigger\) \{([^}]*)\}/)?.[1] ?? '';
  expect(rule).toMatch(/background: var\(--color-control-surface\)/);
  expect(rule).toMatch(/border-radius: var\(--radius-full\)/);
  expect(rule).toMatch(/box-shadow: none/);
});

test('a narrowed composer cuts the model name before the effort', () => {
  const narrow = barSource.slice(barSource.indexOf('@container composer (max-width: 600px)'));
  expect(narrow).toMatch(/\.chips \{ flex-wrap: nowrap; \}/);
  expect(narrow).toMatch(/\.desktop-options \{ flex: none; \}/);
});

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
function lightToken(name: string): string {
  const light = appCss.slice(appCss.indexOf("[data-theme='light'] {"));
  const value = light.match(new RegExp(`--${name}: ([^;]+);`))?.[1];
  if (!value) throw new Error(`no --${name} in the light theme`);
  return value.trim();
}

test('a disabled control keeps 3:1 against its surface in light', () => {
  // The neutral disabled primary: its label against its own fill.
  expect(lightToken('color-disabled-fill')).toBe('var(--color-surface-3)');
  expect(lightToken('color-disabled-ink')).toBe('var(--color-subtle)');
  expect(ratio(lightToken('color-subtle'), lightToken('color-surface-3'))).toBeGreaterThanOrEqual(3);
  expect(appCss).toMatch(/\[data-theme='light'\] button\.primary:disabled \{[^}]*background: var\(--color-disabled-fill\)/);
  // Any other disabled button fades its muted label over the card and the column.
  const opacity = Number(lightToken('disabled-opacity'));
  const muted = lightToken('color-muted-foreground');
  for (const surface of [lightToken('color-surface'), lightToken('color-surface-2')]) {
    const mixed = '#' + [1, 3, 5].map((at) => {
      const fg = parseInt(muted.slice(at, at + 2), 16);
      const bg = parseInt(surface.slice(at, at + 2), 16);
      return Math.round(opacity * fg + (1 - opacity) * bg).toString(16).padStart(2, '0');
    }).join('');
    expect(ratio(mixed, surface)).toBeGreaterThanOrEqual(3);
  }
});
