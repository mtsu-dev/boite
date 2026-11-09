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
// Round 19 raises the small tier a step: round 18's 12.84:1 and 11.39:1 (dark), 11.77:1 and 10.26:1 (light) fail.
// Round 20 one more (timestamps, counts, diff line numbers, the quota line): round 19's 13.19:1 and 11.83:1
// (dark), 12.69:1 and 11.16:1 (light) fail.
const FLOORS = {
  dark: { muted: 13.6, subtle: 12.3, border: 0.09, edge: 0.13 },
  light: { muted: 13.2, subtle: 11.7, border: 0.095, edge: 0.19 }
};

describe.each([
  ['dark', ':root'],
  ['light', "[data-theme='light']"]
] as const)('%s theme', (theme, selector) => {
  const scope = block(selector);

  test('secondary and tertiary text sit one step brighter than round 19', () => {
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

/**
 * Round 18: the frame, the page, a card and a raised fill each sit one visible
 * tonal step apart, so a card reads as a card without glass or a gradient.
 * Round 21 widens the dark ladder to about 4 L* a step (round 20: frame to
 * page 3.8, page to card 3.5, card to raised 2.5) and the light frame to 6.9
 * L* under the page (round 20: 5.5); each new floor fails on round 20's values.
 */
test.each([
  ['dark', ':root', { framePage: 4, pageCard: 3.5, cardRaised: 3.5, pageRaised: 7.5 }],
  ['light', "[data-theme='light']", { framePage: 6.5, pageCard: 2, cardRaised: 1.5, pageRaised: 4 }]
] as const)('%s: frame, page, card and raised fill are one tonal step apart', (_theme, selector, floors) => {
  const scope = block(selector);
  const [frame, page, card, raised] = ['--color-frame', '--color-background', '--color-surface', '--color-surface-2'].map((name) => lightness(token(scope, name)));
  expect(Math.abs(page! - frame!), 'frame to page').toBeGreaterThanOrEqual(floors.framePage);
  expect(Math.abs(card! - page!), 'page to card').toBeGreaterThanOrEqual(floors.pageCard);
  expect(Math.abs(raised! - card!), 'card to raised fill').toBeGreaterThanOrEqual(floors.cardRaised);
  expect(Math.abs(raised! - page!), 'page to raised fill').toBeGreaterThanOrEqual(floors.pageRaised);
});

/**
 * Round 21: one soft elevation for the composer card and a sheet, its top light
 * no stronger than the hairline and its falloff short, so it lifts without a
 * glow; a phone sheet wears it on the sheet fill, the top of the ladder.
 */
test.each([
  ['dark', ':root'],
  ['light', "[data-theme='light']"]
] as const)('%s: one soft elevation, a hairline top light and no glow', (theme, selector) => {
  const scope = block(selector);
  const rule = /--elevation-soft:\s*inset 0 1px 0 rgb\(255 255 255 \/ ([\d.]+)\)([^;]*);/.exec(scope);
  expect(rule, '--elevation-soft').not.toBeNull();
  if (theme === 'dark') expect(Number(rule![1]), 'top light under the hairline').toBeLessThanOrEqual(alpha(scope, '--color-border'));
  const shadows = [...rule![2]!.matchAll(/0 (\d+)px (\d+)px(?: (-?\d+)px)? rgb\(0 0 0 \/ ([\d.]+)\)/g)];
  expect(shadows.length, 'a contact shadow and a falloff').toBe(2);
  // A falloff pulled in under the card by its spread: no halo past its edges.
  for (const [, , blur, spread] of shadows) expect(Number(blur) + 2 * Number(spread ?? 0)).toBeLessThanOrEqual(8);
  expect(block(':root')).toMatch(/--shadow-composer:\s*var\(--elevation-soft\);/);
  expect(css).toMatch(/\[data-mobile-sheet='true'\] \{ background: var\(--color-sheet\) !important; box-shadow: var\(--elevation-soft\) !important; \}/);
});

/**
 * Round 19: a phone's sheet dims the screen behind it less than a dialog does,
 * so the screen it rose from stays in view (round 18 drew the dialog's 0.55 and
 * 0.35). The inset card's top light reads as a layer over the frame without a
 * wide blur, glass or a gradient (round 18: 0.035 in dark).
 */
test.each([
  ['dark', ':root', { sheet: 0.35, light: 0.06 }],
  ['light', "[data-theme='light']", { sheet: 0.22, light: 0.85 }]
] as const)('%s: a sheet dims less than a dialog, the inset card carries a top light', (_theme, selector, most) => {
  const scope = block(selector);
  const [sheet, dialog] = [alpha(scope, '--sheet-scrim'), alpha(scope, '--color-scrim')];
  expect(sheet).toBeLessThanOrEqual(most.sheet);
  expect(sheet).toBeLessThan(dialog);
  expect(sheet, 'still a dim').toBeGreaterThanOrEqual(0.15);
  const frame = /--shadow-frame:\s*inset 0 1px 0 rgb\(255 255 255 \/ ([\d.]+)\)([^;]*);/.exec(scope);
  expect(Number(frame?.[1]), 'top light').toBeGreaterThanOrEqual(most.light);
  // A contact shadow only: no wide blur beside the card.
  for (const blur of [...(frame?.[2] ?? '').matchAll(/0 \d+px (\d+)px/g)].map((match) => Number(match[1]))) expect(blur).toBeLessThanOrEqual(4);
});

test('a phone sheet draws the sheet scrim behind it', () => {
  expect(css).toMatch(/\.mobile-sheet-backdrop \{[^}]*background: var\(--sheet-scrim\)/);
});

/** A switch that is on reads as on at a glance, without the accent: the filled foreground track, a primary's ink as the knob. */
test('a switch on wears the foreground track and its ink knob; off, a quiet track', () => {
  const root = block(':root');
  expect(root).toMatch(/--switch-on:\s*var\(--color-foreground\);/);
  expect(root).toMatch(/--switch-knob-on:\s*var\(--color-on-foreground\);/);
  expect(root).toMatch(/--switch-off:\s*var\(--color-surface-3\);/);
});

test('a menu or popover edge sits one step over the edge, toward the text, in every theme and palette', () => {
  expect(block(':root')).toMatch(/--overlay-edge:\s*color-mix\(in srgb, var\(--color-edge\), var\(--color-foreground\) \d+%\);/);
});

/**
 * The curated palettes carry their own text tiers. Their subtle gets the same
 * lift as the default: within 7 L* of its muted tier, so tertiary text does
 * not read dim on any theme. Round 19 raises the small tier one step, with
 * margin over AA: muted 6.5:1 and subtle 5.5:1 on every ground the palette
 * draws (round 18 sat at 4.5:1: light Catppuccin's muted at 4.65, light Tokyo
 * Night's subtle at 4.51, light Amethyst's at 4.50), and the foreground stays
 * 4 L* clear of the lifted muted so the hierarchy still reads. Round 20 lifts
 * them one more step, to 7:1 and 6:1, each palette set 0.2 over the floor
 * (round 19 sat on it: light Tokyo Night's muted at 6.51, light Catppuccin's
 * subtle at 5.50). The selection stands 5 L* off the surface and the raised
 * fill, so a selected row never differs by a near-identical grey (round 19:
 * light Tokyo Night's 2.5 L* under its raised fill, Nord's 4.2).
 */
describe('curated palettes', () => {
  const ids = [...css.matchAll(/--palette-((?:dark|light)-[\w-]+?)-subtle:/g)].map((match) => match[1]!);
  const PALETTE_GROUNDS = ['background', 'frame', 'surface', 'surface-low', 'surface-high'];

  test('every curated palette is read', () => {
    expect(ids.length).toBeGreaterThanOrEqual(11);
  });

  // Round 21: each palette with margin over the floor (round 20 sat on it: dark Nord's subtle at 6.20, light Tokyo Night's muted at 7.26 before the deeper frame).
  test.each(ids)('%s: muted clears 7.25:1 and subtle 6.25:1 on every ground, subtle within 7 L* of muted, the foreground 4 L* past muted', (id) => {
    const value = (name: string) => new RegExp(`--palette-${id}-${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css)?.[1];
    const grounds = PALETTE_GROUNDS.map(value).filter((hex): hex is string => !!hex);
    const [foreground, muted, subtle] = [value('foreground'), value('muted-foreground'), value('subtle')];
    expect(grounds.length, 'grounds').toBeGreaterThanOrEqual(4);
    expect(muted && subtle, 'muted and subtle').toBeTruthy();
    for (const ground of grounds) {
      expect(ratio(subtle!, ground), `subtle on ${ground}`).toBeGreaterThanOrEqual(6.25);
      expect(ratio(muted!, ground), `muted on ${ground}`).toBeGreaterThanOrEqual(7.25);
      expect(ratio(foreground!, ground), `foreground on ${ground}`).toBeGreaterThanOrEqual(7.25);
    }
    expect(Math.abs(lightness(muted!) - lightness(subtle!)), 'muted to subtle').toBeLessThanOrEqual(7);
    expect(Math.abs(lightness(foreground!) - lightness(muted!)), 'foreground to muted').toBeGreaterThanOrEqual(4);
  });

  /**
   * Round 21: every palette's ladder a clear step a layer. Dark: frame, page, card, raised and pressed climb
   * (round 20: Catppuccin's raised fill sat 3 L* under its page, Tokyo Night's frame 2.5 under it); OLED keeps
   * its black frame and page. Light: the frame well under the page, the raised fill over it, the pressed fill under.
   */
  test.each(ids)('%s: frame, page, card, raised and pressed fills are a clear step apart', (id) => {
    const value = (name: string) => lightness(new RegExp(`--palette-${id}-${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css)![1]!);
    const [frame, page, card, raised, pressed] = ['frame', 'background', 'surface-low', 'surface', 'surface-high'].map(value);
    if (id.startsWith('dark')) {
      if (id !== 'dark-oled') expect(page! - frame!, 'frame to page').toBeGreaterThanOrEqual(4);
      expect(card! - page!, 'page to card').toBeGreaterThanOrEqual(3);
      expect(raised! - card!, 'card to raised').toBeGreaterThanOrEqual(3);
      expect(pressed! - raised!, 'raised to pressed').toBeGreaterThanOrEqual(3);
    } else {
      expect(page! - frame!, 'frame to page').toBeGreaterThanOrEqual(6.5);
      expect(raised! - page!, 'page to raised').toBeGreaterThanOrEqual(4);
      expect(page! - pressed!, 'pressed under the page').toBeGreaterThanOrEqual(3.5);
    }
  });

  test.each(ids)('%s: the selection stands 5 L* off the surface and the raised fill', (id) => {
    const value = (name: string) => new RegExp(`--palette-${id}-${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css)?.[1];
    const selection = lightness(value('selection')!);
    for (const ground of ['surface', 'surface-high']) expect(Math.abs(selection - lightness(value(ground)!)), `selection to ${ground}`).toBeGreaterThanOrEqual(5);
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
    // The instrumental tier of a thread (app.css): the secondary and subtle inks under other names.
    '--instrument-ink', '--instrument-meta',
    // Set by a component to one of the above.
    '--tone', '--verdict', '--mark', '--tint',
    // A palette tile's sample: that palette's own foreground on its own ground (ThemeColors.svelte).
    '--tile-ink'
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

/** `color-mix(in srgb, a p%, b)` on two hex colours: sRGB mixes the encoded channels. */
function mixHex(a: string, share: number, b: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(channel(a, i) * share + channel(b, i) * (1 - share)).toString(16).padStart(2, '0')).join('')}`;
}

/** An `rgba(r, g, b, a)` token laid over a hex ground. */
function over(scope: string, name: string, ground: string): string {
  const match = new RegExp(`${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)\\s*;`, 'i').exec(scope);
  if (!match) throw new Error(`no rgba ${name}`);
  const top = `#${match.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  return mixHex(top, Number(match[4]), ground);
}

/**
 * Round 21: a diff reads again. Round 20's 5 and 16 percent washes read as no
 * change at all: a changed line now carries a wash the eye finds at a glance,
 * the changed words a clear step deeper, add and remove well apart, and code
 * keeps 12:1 on a line, 9:1 on a word, its line number (the secondary ink) 11:1.
 */
describe.each([
  ['dark', ':root'],
  ['light', "[data-theme='light']"]
] as const)('%s: diff washes', (_theme, selector) => {
  const scope = block(selector);
  const root = block(':root');
  const share = (name: string) => {
    const match = new RegExp(`${name}:\\s*color-mix\\(in srgb, var\\((--color-\\w+)\\) (\\d+)%, var\\(--color-surface-2\\)\\);`).exec(root);
    if (!match) throw new Error(`no ${name}`);
    return mixHex(token(scope, match[1]!), Number(match[2]) / 100, token(scope, '--color-surface-2'));
  };
  const raised = token(scope, '--color-surface-2');
  const [addWash, removeWash, addWord, removeWord] = ['--diff-add-wash', '--diff-remove-wash', '--diff-add-word', '--diff-remove-word'].map(share);
  const distance = (a: string, b: string) => Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));

  test('a changed line carries a visible wash, the changed words a step deeper', () => {
    // Round 20's washes sat 10 and 12 apart from the raised fill in sRGB: under this floor.
    for (const wash of [addWash!, removeWash!]) expect(distance(wash, raised), `${wash} reads as tinted`).toBeGreaterThanOrEqual(18);
    expect(distance(addWash!, removeWash!), 'add and remove apart').toBeGreaterThanOrEqual(20);
    expect(Math.abs(lightness(addWord!) - lightness(addWash!)), 'added words').toBeGreaterThanOrEqual(4);
    expect(Math.abs(lightness(removeWord!) - lightness(removeWash!)), 'removed words').toBeGreaterThanOrEqual(4);
  });

  test('code reads at 12:1 on a changed line and 9:1 on a changed word, its line number at 11:1', () => {
    for (const wash of [addWash!, removeWash!]) expect(ratio(token(scope, '--color-foreground'), wash), `code on ${wash}`).toBeGreaterThanOrEqual(12);
    for (const wash of [addWord!, removeWord!]) expect(ratio(token(scope, '--color-foreground'), wash), `code on ${wash}`).toBeGreaterThanOrEqual(9);
    for (const wash of [addWash!, removeWash!]) expect(ratio(token(scope, '--color-muted-foreground'), wash), `line number on ${wash}`).toBeGreaterThanOrEqual(11);
  });

  test('the selection stands a clear step off the surface and the raised fill', () => {
    for (const ground of ['--color-surface', '--color-surface-2']) {
      const base = token(scope, ground);
      expect(Math.abs(lightness(over(scope, '--color-selection', base)) - lightness(base)), `selection on ${ground}`).toBeGreaterThanOrEqual(10);
    }
  });
});

/** Round 20: four neutral roles, an instrumental tier on the secondary inks, one icon stroke by optical size. */
describe('round 20 roles', () => {
  const root = block(':root');

  test('ground, surface, raised and selected name one layer each', () => {
    expect(root).toMatch(/--role-ground:\s*var\(--color-background\);/);
    expect(root).toMatch(/--role-surface:\s*var\(--color-surface\);/);
    expect(root).toMatch(/--role-raised:\s*var\(--color-surface-2\);/);
    expect(root).toMatch(/--role-selected:\s*var\(--color-selection\);/);
  });

  test('the instrumental tier sits one step under the agent words: smaller, on the secondary inks', () => {
    expect(root).toMatch(/--instrument-ink:\s*var\(--color-muted-foreground\);/);
    expect(root).toMatch(/--instrument-meta:\s*var\(--color-subtle\);/);
    expect(root).toMatch(/--instrument-size:\s*var\(--text-body\);/);
    expect(parseInt(/--text-body:\s*(\d+)px/.exec(root)![1]!)).toBeLessThan(parseInt(/--text-title:\s*(\d+)px/.exec(root)![1]!));
    expect(root).toMatch(/--text-min:\s*var\(--text-meta\);/);
  });

  // Round 21: the desktop's secondary tier half a step up and the instrument meta in the secondary ink; the phone keeps 13 px.
  test('the desktop meta reads half a step larger and brighter, still under the body', () => {
    const desktop = /@media \(min-width: 721px\) \{\s*:root \{ --text-meta: ([\d.]+)px; --instrument-meta: var\(--color-muted-foreground\); \}/.exec(css);
    expect(desktop, 'desktop meta rule').not.toBeNull();
    const [meta, body] = [Number(desktop![1]), parseInt(/--text-body:\s*(\d+)px/.exec(root)![1]!)];
    expect(meta).toBeGreaterThan(parseInt(/--text-meta:\s*(\d+)px/.exec(root)![1]!));
    expect(meta).toBeLessThan(body);
  });

  test('every line-set Lucide icon takes the stroke token by optical size; heavier marks keep theirs', () => {
    expect(root).toMatch(/--icon-stroke:\s*1\.75;/);
    const small = Number(/--icon-stroke-small:\s*([\d.]+);/.exec(root)![1]);
    const large = Number(/--icon-stroke-large:\s*([\d.]+);/.exec(root)![1]);
    // About one drawn pixel at 12, 16 and 24 px: stroke times size over Lucide's 24 unit box.
    for (const [stroke, size] of [[small, 12], [1.75, 16], [large, 24]] as const) expect((stroke * size) / 24).toBeGreaterThanOrEqual(0.95);
    expect(css).toMatch(/svg\.lucide:is\(\[stroke-width='1\.5'\], \[stroke-width='1\.6'\], \[stroke-width='1\.75'\], \[stroke-width='2'\]\) \{ stroke-width: var\(--icon-stroke\); \}/);
    expect(css).not.toMatch(/svg\.lucide[^{]*\[stroke-width='2\.25'\]/);
  });
});
