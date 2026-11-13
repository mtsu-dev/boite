import { afterEach, expect, test } from 'vitest';
import { notifyCorner, toastSlot } from './notify-corner';

function box(testid: string, rect: Partial<DOMRect>): HTMLElement {
  const node = document.createElement('div');
  node.dataset.testid = testid;
  const full = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect } as DOMRect;
  node.getBoundingClientRect = () => full;
  node.getClientRects = () => [full] as unknown as DOMRectList;
  document.body.append(node);
  return node;
}

afterEach(() => { document.body.replaceChildren(); window.innerWidth = 1024; window.innerHeight = 768; });

test('on a desktop a toast sits in the top-right corner under the thread header without taking room from the timeline', () => {
  window.innerWidth = 1440;
  box('thread-header', { top: 0, bottom: 48, left: 300, right: 1440, height: 48, width: 1140 });
  const timeline = box('timeline', { top: 48, bottom: 700, left: 300, right: 1300, height: 652, width: 1000 });
  const strip = box('composer-strip', { top: 700, bottom: 734, left: 400, right: 1200, height: 34, width: 800 });
  const toast = document.createElement('div');
  Object.defineProperty(toast, 'offsetHeight', { value: 40 });
  document.body.append(toast);
  const slot = toastSlot(toast);
  expect(toast.dataset.slot).toBe('end');
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
  expect(timeline.dataset.cornerRoom).toBeUndefined();
  expect(strip.style.getPropertyValue('--corner-room')).toBe('');
  // 12 under the header's bottom at 48.
  expect(toast.style.getPropertyValue('--toast-top')).toBe('60px');
  expect(toast.style.getPropertyValue('--toast-left')).toBe('');
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

test('on a phone thread an arriving card takes the room at the bottom of the timeline too, under the toast, never over a line', () => {
  window.innerWidth = 390;
  window.innerHeight = 844;
  const timeline = box('timeline', { top: 56, bottom: 700, left: 0, right: 390, height: 644, width: 390 });
  box('composer', { top: 700, bottom: 844, left: 0, right: 390, height: 144, width: 390 });
  const card = document.createElement('div');
  Object.defineProperty(card, 'offsetHeight', { value: 80 });
  document.body.append(card);
  const corner = notifyCorner(card);
  // 8 above the card, the card, 8 under it, then the composer.
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('96px');
  // Its bottom at 692, 8 above the timeline's end: 844 - 12 - 692.
  expect(card.style.getPropertyValue('--corner-lift')).toBe('140px');
  const toast = document.createElement('div');
  Object.defineProperty(toast, 'offsetHeight', { value: 40 });
  document.body.append(toast);
  const slot = toastSlot(toast);
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('144px');
  expect(toast.style.getPropertyValue('--toast-top')).toBe('564px');
  expect(card.style.getPropertyValue('--corner-lift')).toBe('140px');
  slot.destroy();
  window.innerWidth = 1440;
  window.dispatchEvent(new Event('resize'));
  expect(card.dataset.slot).toBe('top');
  expect(card.style.getPropertyValue('--toast-left')).toBe('');
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
  corner.destroy();
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
});

test('on a desktop thread an arriving card sits in the top-right corner without taking room from the timeline', () => {
  window.innerWidth = 1440;
  window.innerHeight = 768;
  const timeline = box('timeline', { top: 48, bottom: 700, left: 300, right: 1300, height: 652, width: 1000 });
  box('composer', { top: 700, bottom: 768, left: 400, right: 1200, height: 68, width: 800 });
  const card = document.createElement('div');
  Object.defineProperty(card, 'offsetHeight', { value: 80 });
  document.body.append(card);
  const corner = notifyCorner(card);
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
  expect(card.dataset.slot).toBe('top');
  expect(card.style.getPropertyValue('--toast-left')).toBe('');
  expect(card.style.getPropertyValue('--corner-top')).toBe('12px');
  corner.destroy();
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
});

test('a desktop page with no thread keeps the arriving card in the top-right corner, under the title bar', () => {
  window.innerWidth = 1440;
  box('titlebar', { top: 0, bottom: 36, left: 0, right: 1440, height: 36, width: 1440 });
  const card = document.createElement('div');
  Object.defineProperty(card, 'offsetHeight', { value: 80 });
  document.body.append(card);
  const corner = notifyCorner(card);
  expect(card.dataset.slot).toBe('top');
  expect(card.style.getPropertyValue('--corner-top')).toBe('48px');
  corner.destroy();
});

test('while a thread loads, a card and a toast wait out of sight with no room kept, then take their slot once the timeline is there', () => {
  window.innerWidth = 1440;
  window.innerHeight = 768;
  const loading = box('thread-loading', { top: 48, bottom: 700, left: 300, right: 1300, height: 652, width: 1000 });
  box('composer', { top: 700, bottom: 768, left: 400, right: 1200, height: 68, width: 800 });
  const card = document.createElement('div');
  Object.defineProperty(card, 'offsetHeight', { value: 80 });
  document.body.append(card);
  const corner = notifyCorner(card);
  const toast = document.createElement('div');
  Object.defineProperty(toast, 'offsetHeight', { value: 40 });
  document.body.append(toast);
  const slot = toastSlot(toast);
  // Not in the corner over the composer the skeleton leads to: held, unplaced.
  expect(card.dataset.held).toBe('');
  expect(toast.dataset.held).toBe('');
  expect(card.style.getPropertyValue('--corner-lift')).toBe('');
  loading.remove();
  const timeline = box('timeline', { top: 48, bottom: 700, left: 300, right: 1300, height: 652, width: 1000 });
  slot.destroy();
  expect(card.dataset.held).toBeUndefined();
  expect(card.dataset.slot).toBe('top');
  expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
  corner.destroy();
});

test('a desktop page with no thread stacks the arriving card under a toast in the corner, never over it', () => {
  window.innerWidth = 1440;
  window.innerHeight = 768;
  const toast = document.createElement('div');
  Object.defineProperty(toast, 'offsetHeight', { value: 40 });
  document.body.append(toast);
  const slot = toastSlot(toast);
  const card = document.createElement('div');
  Object.defineProperty(card, 'offsetHeight', { value: 80 });
  document.body.append(card);
  const corner = notifyCorner(card);
  expect(toast.dataset.slot).toBe('end');
  // The toast from 12 to 52: the card starts 8 under it.
  expect(toast.style.getPropertyValue('--toast-top')).toBe('12px');
  expect(card.style.getPropertyValue('--corner-top')).toBe('60px');
  slot.destroy();
  expect(card.style.getPropertyValue('--corner-top')).toBe('12px');
  corner.destroy();
});

test('desktop corner cards stack under toasts at the top, away from the composer strip, queue and permission', () => {
  window.innerWidth = 1440;
  window.innerHeight = 768;
  box('thread-header', { top: 0, bottom: 48, left: 300, right: 1440, height: 48, width: 1140 });
  const timeline = box('timeline', { top: 48, bottom: 460, left: 300, right: 1440, height: 412, width: 1140 });
  const wrap = box('composer-wrap', { top: 460, bottom: 768, left: 384, right: 1440, height: 308, width: 1056 });
  wrap.className = 'composer-wrap';
  wrap.append(
    box('composer-strip', { top: 460, bottom: 500, left: 400, right: 1424, height: 40, width: 1024 }),
    box('composer-strip-lines', { top: 500, bottom: 668, left: 400, right: 1424, height: 168, width: 1024 }),
    box('composer-foot', { top: 668, bottom: 700, left: 400, right: 1424, height: 32, width: 1024 }),
    box('composer', { top: 700, bottom: 768, left: 400, right: 1424, height: 68, width: 1024 })
  );
  const toast = box('toast', { left: 1084, right: 1424, width: 340 });
  Object.defineProperty(toast, 'offsetHeight', { value: 40 });
  const slot = toastSlot(toast);
  const card = box('card', { left: 1084, right: 1424, width: 340 });
  Object.defineProperty(card, 'offsetHeight', { value: 80 });
  const corner = notifyCorner(card);
  try {
    expect(timeline.style.getPropertyValue('--corner-room')).toBe('');
    expect(toast.dataset.slot).toBe('end');
    // 12 under the thread header at 48, the card 8 under the toast.
    expect(toast.style.getPropertyValue('--toast-top')).toBe('60px');
    expect(card.style.getPropertyValue('--corner-top')).toBe('108px');
  } finally { slot.destroy(); corner.destroy(); }
});
