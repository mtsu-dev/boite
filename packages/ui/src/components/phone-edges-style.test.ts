import { expect, test } from 'vitest';
import headerSource from './ThreadHeader.svelte?raw';
import navigationSource from './MobileNavigation.svelte?raw';
import settingsSource from './MobileSettings.svelte?raw';
import shellSource from './SettingsShell.svelte?raw';
import appSource from '../App.svelte?raw';

// jsdom lays nothing out, so these read the rules the browser would apply.

function phone(source: string): string {
  return source.slice(source.indexOf('@media (max-width: 720px)'));
}

test('a phone thread title wraps to two lines before its ellipsis, and the header grows for it', () => {
  const title = phone(headerSource).match(/\.title-text \{([^}]*)\}/)?.[1] ?? '';
  expect(title).toMatch(/-webkit-line-clamp: 2/);
  expect(title).toMatch(/white-space: normal/);
  expect(title).not.toMatch(/white-space: nowrap/);
  // The slot around the header has a floor, not a fixed height that would cut the second line.
  const slot = phone(navigationSource).match(/\.chat-heading \{([^}]*)\}/)?.[1] ?? '';
  expect(slot).toMatch(/min-height: 44px/);
  expect(slot).not.toMatch(/(^|[^-])height:/);
});

test('phone settings run under the tab bar, clear it at the end and fade behind the capsule', () => {
  expect(appSource).toMatch(/\.app\.off-chat\.tabbed\.on-settings \.body \{ grid-row: 2 \/ 4; \}/);
  expect(appSource).toContain("class:on-settings={store.page === 'settings'}");
  const pages = settingsSource.match(/:global\(\.app\.tabbed\) :is\(\.home, \.detail\) \{([^}]*)\}/)?.[1] ?? '';
  expect(pages).toMatch(/mask-image: linear-gradient\(to top, transparent 0 var\(--bar-gap\), black calc\(var\(--bar-gap\) \+ 24px\)\)/);
  // A detail's page scrolls itself (app.css `.page`): the end room is its own, or the page stops 96 px short, cut flat.
  expect(settingsSource).toMatch(/:global\(\.app\.tabbed\) :is\(\.home, \.detail > :global\(:last-child\)\) \{ padding-bottom: 96px; \}/);
});

test('the desktop settings edge fades over more than one 13 px line', () => {
  const fade = shellSource.match(/\.framed \{ --fade: (\d+)px; \}/)?.[1];
  expect(Number(fade)).toBeGreaterThanOrEqual(24);
});
