import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const go = vi.fn(() => Promise.resolve());
const trail = { behind: false };
vi.mock('./view-history.svelte', () => ({ go, trail }));
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
  go.mockClear(); leave.mockClear(); trail.behind = false;
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

test('wider than a phone, Back walks the views shown before, and leaves at the first one', () => {
  width(false);
  trail.behind = true;
  answerAndroidBack();
  expect([go.mock.calls, leave.mock.calls.length]).toEqual([[[-1]], 0]);
  trail.behind = false;
  answerAndroidBack();
  expect(leave).toHaveBeenCalledTimes(1);
});
