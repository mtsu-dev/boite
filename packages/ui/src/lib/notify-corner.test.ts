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

afterEach(() => { document.body.replaceChildren(); });

test('a toast sits under the thread header, centred on the timeline, never in the strip over the composer', () => {
  box('thread-header', { top: 0, bottom: 48, left: 300, right: 1440, height: 48, width: 1140 });
  const timeline = box('timeline', { top: 48, bottom: 700, left: 300, right: 1300, height: 652, width: 1000 });
  const strip = box('composer-strip', { top: 700, bottom: 734, left: 400, right: 1200, height: 34, width: 800 });
  const toast = document.createElement('div');
  Object.defineProperty(toast, 'offsetHeight', { value: 40 });
  document.body.append(toast);
  const slot = toastSlot(toast);
  expect(toast.dataset.slot).toBe('top');
  expect(toast.style.getPropertyValue('--toast-top')).toBe('56px');
  expect(toast.style.getPropertyValue('--toast-left')).toBe('800px');
  // The timeline keeps the toast's room at its top; the strip keeps none.
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('48px');
  expect(strip.style.getPropertyValue('--corner-room')).toBe('');
  slot.destroy();
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
});
