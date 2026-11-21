import { afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { releaseVersion } from './release-version';
import { loadLocale } from './src/lib/i18n.svelte';

// What Vite's define gives the app (`vite.config.ts`). Set here rather than in
// vitest.config.ts, whose hash keys CI's transform cache: a change there runs
// every pull request on a cold cache.
vi.stubGlobal('__BOITE_VERSION__', releaseVersion());
Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (media: string) => Object.assign(new EventTarget(), {
  media, matches: false, onchange: null, addListener() {}, removeListener() {}
}) });

// jsdom has no layout. Browser tests cover measured sizes and scrolling.
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

// jsdom's user-agent sheet hides `[popover]:not(:popover-open)`, but jsdom has
// no Popover API and its selector engine never matches `:popover-open`
// (jsdom/jsdom#3721), so every popover counts as display: none. Since jsdom
// 30.1, focus() refuses an element hidden that way. The app only keeps a
// `[popover]` node mounted while it is open (floating.ts, ContextMenu), which a
// browser shows through showPopover(), so here it is shown as one. jsdom
// cascades its user-agent sheet and the page's by specificity alone, so this
// rule repeats the hiding selector to outrank it; `hidden` and an inline
// `display` still win, as in a browser.
const popoverShown = document.createElement('style');
popoverShown.textContent = '[popover]:not(:popover-open):not(dialog[open]):not([hidden]) { display: block; }';
document.head.append(popoverShown);

// Nor a canvas: say so quietly, as a browser without one would, instead of
// jsdom's "not implemented" on every image attached.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom has no Web Animations either, so a Svelte transition ends at once here.
if (typeof Element.prototype.animate !== 'function') {
  Element.prototype.animate = function animate() {
    const animation = { currentTime: 0, playState: 'finished', onfinish: null as (() => void) | null, cancel() {}, finish() {} };
    queueMicrotask(() => animation.onfinish?.());
    return animation as unknown as Animation;
  };
}

vi.stubGlobal('matchMedia', (media: string) => ({
  media,
  matches: false,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return true; }
}));

// English is a chunk of its own, which the app's boot awaits (`main.ts`): a
// test renders after it landed, as the app does.
await loadLocale('en');

// Every part, deferred or idle, is a LazyComponent built when its registry
// module runs. Counting them tells whether a test file's imports reach one:
// most files (lib, store and plain component tests) reach none and skip the
// preload below, which was about half the CPU time of such a file.
const lazy = vi.hoisted(() => ({ built: 0 }));
vi.mock('./src/lib/lazy-component.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('./src/lib/lazy-component.svelte')>();
  class LazyComponent<T> extends real.LazyComponent<T> {
    constructor(loader: () => Promise<{ default: T }>) {
      super(loader);
      // One a test file builds for itself (Deferred.test.ts) is no part of the app.
      const caller = new Error().stack?.split('\n').slice(1).find((frame) => !frame.includes('test-setup.ts')) ?? '';
      if (!/\.test\.ts\b/.test(caller)) lazy.built++;
    }
  }
  return { ...real, LazyComponent };
});

// The parts the app fetches once it is idle (`lib/deferred-parts.ts`) are here
// before a test draws, as they are for a user's first open; a test of the
// moment before they land asks for that state itself. In a hook, so it runs
// once the test file is collected: that file's `vi.mock` calls then hold for
// the store modules these parts import, which a top-level import here would
// have cached unmocked.
let preloaded = false;
async function preloadParts(): Promise<void> {
  preloaded = true;
  const { prefetchParts, parts } = await import('./src/lib/deferred-parts');
  const { mobileNavigation } = await import('./src/lib/mobile-navigation');
  prefetchParts();
  await Promise.all(Object.values(parts).map((part) => part.load()));
  // So is the phone's navigation, which App fetches with the app outside the shell.
  await mobileNavigation.load();
  // And the decision card and the permission card, which the composer fetches at idle (`lib/idle-parts.ts`).
  const idle = await import('./src/lib/idle-parts');
  await Promise.all([idle.threadDecision.load(), idle.permissionCard.load()]);
  // A cold worker transforms these modules first: several seconds on a busy machine.
}
beforeAll(async () => {
  if (lazy.built) await preloadParts();
}, 120_000);
// A file that imports a part's module inside a test: the tests after it get the parts.
beforeEach(async () => {
  if (lazy.built && !preloaded) await preloadParts();
}, 120_000);
// The test that imported it ran without them, which no test expects: say so.
afterEach(() => {
  if (lazy.built && !preloaded) throw new Error('this test imported a lazy part\'s module (lib/deferred-parts.ts and its kin) inside the test: import it at the top of the file, so the parts are preloaded before the test draws');
});
