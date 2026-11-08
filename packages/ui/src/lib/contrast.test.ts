import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const css = readFileSync(resolve('src/app.css'), 'utf8');

/**
 * The text tiers of `app.css` against every ground they sit on, in both
 * themes. The subtle tier carries paths, timestamps and hints, so it is text
 * and has to clear WCAG AA (4.5:1) on the raised surface-3 too. Round 14 lifts
 * it one step: 8:1 on every ground, and within 7 L* of the muted tier, while
 * the three tiers stay at least 4 L* apart so the hierarchy still reads.
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

/** CIE lightness (0 to 100): equal steps look equal, which a contrast ratio near white does not. */
function lightness(hex: string): number {
  const y = luminance(hex);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

const GROUNDS = ['--color-background', '--color-frame', '--color-surface', '--color-surface-2', '--color-surface-3'];

/** The alpha of a hairline written as `rgba(r, g, b, a)`. */
function alpha(scope: string, name: string): number {
  const match = new RegExp(`${name}:\\s*rgba\\([^)]*,\\s*([\\d.]+)\\)\\s*;`, 'i').exec(scope);
  if (!match?.[1]) throw new Error(`no rgba ${name}`);
  return Number(match[1]);
}

/**
 * Round 15 lifted the grey one step: secondary text, the hairline and the edge
 * that must read (round 14: hairline 0.075 and 0.08, edge 0.11 and 0.16).
 * Round 16 lifts the text once more, the small meta still read as dim: the
 * floors below fail on round 15's values (secondary 12.27:1 and 10.61:1 at
 * worst, subtle 10.75:1 and 9.14:1).
 */
const FLOORS = {
  dark: { muted: 12.8, subtle: 11.3, border: 0.09, edge: 0.13 },
  light: { muted: 11.5, subtle: 10.1, border: 0.095, edge: 0.19 }
};

describe.each([
  ['dark', ':root'],
  ['light', "[data-theme='light']"]
] as const)('%s theme', (theme, selector) => {
  const scope = block(selector);

  test('secondary and tertiary text sit one step brighter than round 15', () => {
    for (const ground of GROUNDS) {
      expect(ratio(token(scope, '--color-muted-foreground'), token(scope, ground)), `muted on ${ground}`).toBeGreaterThanOrEqual(FLOORS[theme].muted);
      expect(ratio(token(scope, '--color-subtle'), token(scope, ground)), `subtle on ${ground}`).toBeGreaterThanOrEqual(FLOORS[theme].subtle);
    }
  });

  test('the hairline and the edge read one step stronger, the edge still over the hairline', () => {
    const [border, edge] = [alpha(scope, '--color-border'), alpha(scope, '--color-edge')];
    expect(border).toBeGreaterThanOrEqual(FLOORS[theme].border);
    expect(edge).toBeGreaterThanOrEqual(FLOORS[theme].edge);
    expect(edge).toBeGreaterThan(border);
  });

  test.each(['--color-subtle', '--color-muted-foreground'])('%s clears 4.5:1 on every ground', (tier) => {
    for (const ground of GROUNDS) expect(ratio(token(scope, tier), token(scope, ground)), `${tier} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  test('subtle, the faintest informational text, clears 8:1 on every ground', () => {
    for (const ground of GROUNDS) expect(ratio(token(scope, '--color-subtle'), token(scope, ground)), `subtle on ${ground}`).toBeGreaterThanOrEqual(8);
  });

  test('the three tiers stay a visible step apart, subtle one step under muted', () => {
    const [primary, muted, subtle] = ['--color-foreground', '--color-muted-foreground', '--color-subtle'].map((name) => lightness(token(scope, name)));
    expect(Math.abs(primary! - muted!), 'primary to muted').toBeGreaterThanOrEqual(4);
    expect(Math.abs(muted! - subtle!), 'muted to subtle').toBeGreaterThanOrEqual(4);
    // More than one step under muted reads as dim (round 13: 8.6 L* in dark, 8.8 in light).
    expect(Math.abs(muted! - subtle!), 'muted to subtle').toBeLessThanOrEqual(7);
  });
});

test('a menu or popover edge sits one step over the edge, toward the text, in every theme and palette', () => {
  expect(block(':root')).toMatch(/--overlay-edge:\s*color-mix\(in srgb, var\(--color-edge\), var\(--color-foreground\) \d+%\);/);
});

/**
 * The curated palettes carry their own text tiers. Their subtle gets the same
 * lift as the default: 4.5:1 on every ground the palette draws, and within
 * 7 L* of its muted tier, so tertiary text does not read dim on any theme.
 * Where a palette's own foreground sits near 4.5:1 on its raised ground
 * (light Catppuccin, light Tokyo Night), the tiers keep their hues apart.
 */
describe('curated palettes', () => {
  const ids = [...css.matchAll(/--palette-((?:dark|light)-[\w-]+?)-subtle:/g)].map((match) => match[1]!);
  const PALETTE_GROUNDS = ['background', 'frame', 'surface', 'surface-low', 'surface-high'];

  test('every curated palette is read', () => {
    expect(ids.length).toBeGreaterThanOrEqual(11);
  });

  test.each(ids)('%s: muted and subtle clear 4.5:1 on every ground, subtle within 7 L* of muted', (id) => {
    const value = (name: string) => new RegExp(`--palette-${id}-${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css)?.[1];
    const grounds = PALETTE_GROUNDS.map(value).filter((hex): hex is string => !!hex);
    const [muted, subtle] = [value('muted-foreground'), value('subtle')];
    expect(grounds.length, 'grounds').toBeGreaterThanOrEqual(4);
    expect(muted && subtle, 'muted and subtle').toBeTruthy();
    for (const ground of grounds) {
      expect(ratio(subtle!, ground), `subtle on ${ground}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(muted!, ground), `muted on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(Math.abs(lightness(muted!) - lightness(subtle!)), 'muted to subtle').toBeLessThanOrEqual(7);
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
    // Code's inks and the warning that asks nothing, each set in app.css at reading contrast.
    '--syntax-keyword', '--syntax-string', '--syntax-comment', '--color-caution',
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

/**
 * One segmented control everywhere, its chosen option a raised neutral: a
 * step over the frame its track sits on, with the edge hairline, never the
 * full ink (round 16 drew it white, louder than the accent and every primary
 * button on the page). A component that restyles the chosen segment brings a
 * second look back.
 */
describe('the chosen segment', () => {
  const rule = /\.segmented button:is\(\.on, \[aria-pressed='true'\]\) \{([^}]*)\}/.exec(css)?.[1] ?? '';

  test('is drawn once in app.css, raised on the segment token with the edge, in the ink', () => {
    expect(rule).toMatch(/background:\s*var\(--segment-on\)/);
    expect(rule).toMatch(/border-color:\s*var\(--color-edge\)/);
    expect(rule).toMatch(/(?:^|;)\s*color:\s*var\(--color-foreground\)/);
    expect(rule).not.toMatch(/--color-on-foreground/);
  });

  test('sits a visible step over the frame in dark and is the white card over the grey frame in light', () => {
    const dark = block(':root');
    // `--segment-on` mixes surface-3 toward the ink in oklab; for a neutral grey oklab's L is the cube root of luminance.
    const mix = /--segment-on:\s*color-mix\(in oklab, var\(--color-surface-3\), var\(--color-foreground\) (\d+)%\);/.exec(dark);
    expect(mix, 'dark --segment-on').not.toBeNull();
    const share = Number(mix![1]) / 100;
    const oklabL = (1 - share) * Math.cbrt(luminance(token(dark, '--color-surface-3'))) + share * Math.cbrt(luminance(token(dark, '--color-foreground')));
    const y = oklabL ** 3;
    const cie = y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
    expect(cie - lightness(token(dark, '--color-frame')), 'raise over the frame').toBeGreaterThanOrEqual(15);
    expect(lightness(token(dark, '--color-foreground')) - cie, 'still far under the ink').toBeGreaterThanOrEqual(60);
    expect(block("[data-theme='light']")).toMatch(/--segment-on:\s*var\(--color-surface-2\);/);
    const light = block("[data-theme='light']");
    expect(lightness(token(light, '--color-surface-2'))).toBeGreaterThan(lightness(token(light, '--color-frame')));
  });

  test('no component draws its own chosen segment', () => {
    const own: string[] = [];
    for (const file of readdirSync(resolve('src/components'), { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.svelte')) continue;
      const text = readFileSync(join(resolve('src/components'), file), 'utf8');
      const style = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
      if (/\.segmented button(?:\.on|\[aria-pressed='true'\])[^{]*\{[^}]*background/.test(style)) own.push(file);
    }
    expect(own).toEqual([]);
  });
});
