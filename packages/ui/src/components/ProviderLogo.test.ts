import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ProviderLogo from './ProviderLogo.svelte';
import { providerLogos } from '../lib/provider-logos';

/**
 * The rail draws providers and nothing else, so a mark that fails to draw has to
 * fall back to something readable rather than to an empty tile.
 */

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
});

function draw(providerId: string, size = 18): void {
  running = mount(ProviderLogo, { target: document.body, props: { providerId, size } });
  flushSync();
}

function pathsOf(providerId: string) {
  const logo = providerLogos[providerId];
  if (logo?.kind !== 'paths') throw new Error(`${providerId} is not drawn as paths`);
  return logo;
}

test('every agent Boite ships has a mark, and only those', () => {
  expect(Object.keys(providerLogos).sort()).toEqual(['antigravity', 'claude', 'codex', 'grok', 'muse', 'opencode', 'pi']);
});

test('a gateway name for a shipped agent draws that agent, not an initial', () => {
  draw('opencode_go');
  expect(document.querySelector('[data-initial]')).toBeNull();
  expect(document.querySelector('svg')).not.toBeNull();
});

test('a mark in one colour draws its path at the size it was given, in that colour', () => {
  draw('claude', 20);

  const svg = document.querySelector('svg[data-logo=claude]');
  expect(svg).not.toBeNull();
  expect(svg?.getAttribute('width')).toBe('20');
  expect(svg?.getAttribute('viewBox')).toBe('0 0 256 257');
  const path = svg?.querySelector('path');
  expect(path?.getAttribute('d')).toBe(pathsOf('claude').paths[0]?.d);
  expect(path?.getAttribute('fill')).toBe('#d97757');
  expect(document.querySelector('[data-initial]')).toBeNull();
});

test('a mark that follows the theme carries both colours and lets the stylesheet pick', () => {
  draw('opencode');

  const paths = Array.from(document.querySelectorAll('svg[data-logo=opencode] path'));
  expect(paths.map((path) => path.getAttribute('d'))).toEqual(pathsOf('opencode').paths.map((path) => path.d));
  const frame = paths[1] as SVGPathElement;
  expect(frame.classList.contains('themed')).toBe(true);
  expect(frame.getAttribute('fill')).toBeNull();
  expect(frame.style.getPropertyValue('--fill-dark')).toBe('#F1ECEC');
  expect(frame.style.getPropertyValue('--fill-light')).toBe('#211E1E');
});

test('a mark on its own tile draws the tile under the paths', () => {
  draw('pi');

  const svg = document.querySelector('svg[data-logo=pi]');
  expect(svg?.firstElementChild?.tagName.toLowerCase()).toBe('rect');
  expect(svg?.querySelector('rect')?.getAttribute('rx')).toBe('160');
  expect(svg?.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd');
});

test('a raster mark is an image filling its view box', () => {
  draw('antigravity');

  const image = document.querySelector('svg[data-logo=antigravity] image');
  expect(image?.getAttribute('href')).toMatch(/antigravity.*\.png|^data:image\/png/);
  expect(image?.getAttribute('width')).toBe('128');
  expect(document.querySelector('svg[data-logo=antigravity]')?.getAttribute('viewBox')).toBe('0 0 128 128');
});

test('a provider nobody drew falls back to its initial', () => {
  draw('echo');

  expect(document.querySelector('svg')).toBeNull();
  const initial = document.querySelector('[data-initial=echo]');
  expect(initial?.textContent?.trim()).toBe('E');
});

test('a mono mark paints one shape in currentColor: bare paths, a tile with its mark cut out, a raster by its alpha', () => {
  for (const id of ['claude', 'pi', 'antigravity']) {
    running = mount(ProviderLogo, { target: document.body, props: { providerId: id, size: 13, mono: true } });
    flushSync();
    const svg = document.querySelector('svg[data-mono]')!;
    const painted = [...svg.querySelectorAll('rect, path, image')].filter(node => !node.closest('mask'));
    expect(painted.map(node => node.getAttribute('fill')), id).toEqual(['currentColor']);
    expect(painted[0]!.getAttribute('mask'), id).toMatch(/^url\(#.+-mono\)$/);
    const mask = svg.querySelector('mask')!;
    expect(mask.id, id).toBe(painted[0]!.getAttribute('mask')!.slice(5, -1));
    if (id === 'pi') expect([...mask.querySelectorAll('path')].every(path => path.getAttribute('fill') === 'black')).toBe(true);
    if (id === 'antigravity') expect(mask.style.getPropertyValue('mask-type')).toBe('alpha');
    unmount(running, { outro: false }); running = null; document.body.innerHTML = '';
  }
});
