import { afterEach, beforeEach, expect, test, vi } from 'vitest';

/** Whether a view still existing lies behind: what the walk itself finds. */
let behind = false;
const go = vi.fn(() => Promise.resolve(behind));
vi.mock('./view-history.svelte', () => ({ go }));
const { answerAndroidBack } = await import('./android-back');
const { mobileOverlay } = await import('./mobile-history');

const width = (phone: boolean) => Object.defineProperty(window, 'matchMedia', {
  configurable: true, writable: true,
  value: (media: string) => ({ media, matches: phone, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
});
const leave = vi.fn();
let original: typeof window.matchMedia;

beforeEach(() => {
  original = window.matchMedia;
  (window as { BoiteAndroid?: unknown }).BoiteAndroid = { leave };
});
afterEach(async () => {
  window.matchMedia = original;
  delete (window as { BoiteAndroid?: unknown }).BoiteAndroid;
  go.mockClear(); leave.mockClear(); behind = false;
  await new Promise(resolve => setTimeout(resolve, 20));
});

test('on a phone, Back closes the open screen first, then sends the app to the background', () => {
  width(true);
  const closed: string[] = [];
  const release: () => void = mobileOverlay(() => { closed.push('conversation'); release(); });
  answerAndroidBack();
  expect([closed, leave.mock.calls.length]).toEqual([['conversation'], 0]);
  answerAndroidBack();
  expect(leave).toHaveBeenCalledTimes(1);
  expect(go).not.toHaveBeenCalled();
});

test('wider than a phone, Back walks the views shown before, and leaves once the walk finds none left', async () => {
  width(false);
  behind = true;
  answerAndroidBack();
  await Promise.resolve(); await Promise.resolve();
  expect([go.mock.calls, leave.mock.calls.length]).toEqual([[[-1]], 0]);
  // Every view behind was closed meanwhile: the walk forgets them and finds nothing, so the app leaves.
  behind = false;
  answerAndroidBack();
  await Promise.resolve(); await Promise.resolve();
  expect(leave).toHaveBeenCalledTimes(1);
});
