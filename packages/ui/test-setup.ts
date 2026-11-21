import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// The registries the preload below loads. A test file whose imports ran none
// of them can draw none of their parts: most files (lib, store and plain
// component tests) skip the preload, which was about half the CPU time of such
// a file. Vitest's module map tells which ran, a file's `vi.mock` of one with
// its original included.
// (Joined by hand: Vite turns `new URL(path, import.meta.url)` into an asset import.
// Vite keys the map with `/` on every OS, so Windows separators are swapped.)
const lib = join(dirname(fileURLToPath(import.meta.url)), 'src', 'lib');
const registries = ['deferred-parts', 'nested-parts', 'idle-parts', 'mobile-navigation'].map((name) => join(lib, `${name}.ts`).replaceAll('\\', '/'));
type ModuleNode = { id?: string; evaluated?: boolean; promise?: unknown };
type ModuleMap = Map<string, Set<ModuleNode>>;
// The module itself, not a `?url` or `?raw` import of its file.
const ran = (modules: ModuleMap, file: string) => [...(modules.get(file) ?? [])].some((node) => node.id === file && (node.evaluated || node.promise));
const self = fileURLToPath(import.meta.url).replaceAll('\\', '/');
function reachedRegistry(): boolean {
  try {
    const modules = (globalThis as { __vitest_worker__?: { evaluatedModules?: { fileToModulesMap?: ModuleMap } } })
      .__vitest_worker__?.evaluatedModules?.fileToModulesMap;
    // A Vitest whose map is gone or changed shape, so that even this file is
    // not found in it, preloads for every file, as before.
    if (!modules || !ran(modules, self)) return true;
    return registries.some((file) => ran(modules, file));
  } catch {
    return true;
  }
}

// The parts the app fetches once it is idle (`lib/deferred-parts.ts`) are here
// before a test draws, as they are for a user's first open; a test of the
// moment before they land asks for that state itself. In a hook, so it runs
// once the test file is collected: that file's `vi.mock` calls then hold for
// the store modules these parts import, which a top-level import here would
// have cached unmocked.
let preloaded = false;
async function preloadParts(): Promise<void> {
  const { prefetchParts, parts } = await import('./src/lib/deferred-parts');
  const { mobileNavigation } = await import('./src/lib/mobile-navigation');
  prefetchParts();
  await Promise.all(Object.values(parts).map((part) => part.load()));
  // So is the phone's navigation, which App fetches with the app outside the shell.
  await mobileNavigation.load();
  // And the decision card and the permission card, which the composer fetches at idle (`lib/idle-parts.ts`).
  const idle = await import('./src/lib/idle-parts');
  await Promise.all([idle.threadDecision.load(), idle.permissionCard.load()]);
  // Only once it all landed: a failed load is tried again before the next test.
  preloaded = true;
  // A cold worker transforms these modules first: several seconds on a busy machine.
}
beforeAll(async () => {
  if (reachedRegistry()) await preloadParts();
}, 120_000);
// A file that imports a registry inside a test: the tests after it get the parts.
beforeEach(async () => {
  if (!preloaded && reachedRegistry()) await preloadParts();
}, 120_000);
// The test that imported it may have drawn without them, which no test expects: say so.
afterEach(() => {
  if (!preloaded && reachedRegistry()) throw new Error('this test imported a part registry (lib/deferred-parts.ts, nested-parts.ts, idle-parts.ts or mobile-navigation.ts) inside the test: import it at the top of the file, so its parts load before the test draws');
});
