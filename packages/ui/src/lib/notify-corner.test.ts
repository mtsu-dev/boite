import { afterEach, expect, test } from 'vitest';
import { toastSlot } from './notify-corner';

function box(testid: string, rect: Partial<DOMRect>): HTMLElement {
  const node = document.createElement('div');
  node.dataset.testid = testid;
  const full = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect } as DOMRect;
  node.getBoundingClientRect = () => full;
  node.getClientRects = () => [full] as unknown as DOMRectList;
  document.body.append(node);
  return node;
}

afterEach(() => { document.body.replaceChildren(); window.innerWidth = 1024; });

test('on a desktop a toast sits in room at the bottom of the timeline, right above the composer, never over a line or in the strip', () => {
  window.innerWidth = 1440;
  box('thread-header', { top: 0, bottom: 48, left: 300, right: 1440, height: 48, width: 1140 });
  const timeline = box('timeline', { top: 48, bottom: 700, left: 300, right: 1300, height: 652, width: 1000 });
  const strip = box('composer-strip', { top: 700, bottom: 734, left: 400, right: 1200, height: 34, width: 800 });
  const toast = document.createElement('div');
  Object.defineProperty(toast, 'offsetHeight', { value: 40 });
  document.body.append(toast);
  const slot = toastSlot(toast);
  expect(toast.dataset.slot).toBe('bottom');
  // The timeline gives way at its bottom: 8 above the toast, the toast, 8 under it, then the strip.
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('56px');
  expect(timeline.dataset.cornerRoom).toBe('bottom');
  expect(strip.style.getPropertyValue('--corner-room')).toBe('');
  expect(toast.style.getPropertyValue('--toast-top')).toBe('652px');
  expect(toast.style.getPropertyValue('--toast-left')).toBe('800px');
  slot.destroy();
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
});

test('on a phone list a toast sits in room at the bottom of the list, above the tab bar, never under the header over a row', () => {
  window.innerWidth = 390;
  box('mobile-header', { top: 0, bottom: 56, left: 0, right: 390, height: 56, width: 390 });
  // The thread still lays out under the list screen that covers it.
  const timeline = box('timeline', { top: 56, bottom: 700, left: 0, right: 390, height: 644, width: 390 });
  const list = box('mobile-list', { top: 56, bottom: 780, left: 0, right: 390, height: 724, width: 390 });
  box('mobile-tabs', { top: 780, bottom: 844, left: 0, right: 390, height: 64, width: 390 });
  const toast = document.createElement('div');
  Object.defineProperty(toast, 'offsetHeight', { value: 40 });
  document.body.append(toast);
  const slot = toastSlot(toast);
  expect(toast.dataset.slot).toBe('bottom');
  // The list gives way at its bottom: 8 above the toast, the toast, 8 under it.
  expect(list.dataset.cornerRoom).toBe('bottom');
  expect(list.style.getPropertyValue('--corner-room')).toBe('56px');
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
  expect(toast.style.getPropertyValue('--toast-top')).toBe('732px');
  expect(toast.style.getPropertyValue('--toast-left')).toBe('195px');
  slot.destroy();
  expect(list.dataset.cornerRoom).toBeUndefined();
});
