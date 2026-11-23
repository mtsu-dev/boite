import { afterEach, expect, test, vi } from 'vitest';
import { readZoom, stepZoom, wheelSteps, ZOOM_DEFAULT, ZOOM_KEY, ZOOM_STEPS, zoomKey } from './zoom';

const webview = vi.hoisted(() => ({ setZoom: (_factor: number): Promise<void> => Promise.resolve() }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => webview }));

afterEach(() => {
  localStorage.clear();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

test('a zoom walks the ladder and stops at its ends', () => {
  expect(stepZoom(1, 1)).toBe(1.1);
  expect(stepZoom(1, -1)).toBe(0.9);
  expect(stepZoom(ZOOM_STEPS[0]!, -1)).toBe(ZOOM_STEPS[0]);
  expect(stepZoom(ZOOM_STEPS.at(-1)!, 1)).toBe(ZOOM_STEPS.at(-1));
  // Off the ladder, the walk starts from 100 %.
  expect(stepZoom(1.33, 1)).toBe(1.1);
});

test('Ctrl with plus, minus or zero zooms, whatever the keyboard layout', () => {
  expect(zoomKey(key({ key: '=', ctrlKey: true }))).toBe(1);
  expect(zoomKey(key({ key: '+', ctrlKey: true, shiftKey: true }))).toBe(1);
  expect(zoomKey(key({ key: '-', ctrlKey: true }))).toBe(-1);
  expect(zoomKey(key({ key: '0', metaKey: true }))).toBe(0);
  expect(zoomKey(key({ key: '+' }))).toBeNull();
  expect(zoomKey(key({ key: '+', ctrlKey: true, altKey: true }))).toBeNull();
  expect(zoomKey(key({ key: 'k', ctrlKey: true }))).toBeNull();
});

test('a stored factor off the ladder reads as 100 %', () => {
  localStorage.setItem(ZOOM_KEY, '1.25');
  expect(readZoom()).toBe(1.25);
  localStorage.setItem(ZOOM_KEY, '3');
  expect(readZoom()).toBe(ZOOM_DEFAULT);
});

test('a reset pressed while a step is on its way lands after it', async () => {
  vi.resetModules();
  const zoom = await import('./zoom');
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  const applied: number[] = [];
  const pending: Array<() => void> = [];
  webview.setZoom = (factor) => new Promise((resolve) => pending.push(() => { applied.push(factor); resolve(); }));
  const worn: number[] = [];
  zoom.subscribeZoom((factor) => worn.push(factor));

  const step = zoom.setZoom(zoom.stepZoom(zoom.wantedZoom(), 1));
  const twice = zoom.setZoom(zoom.stepZoom(zoom.wantedZoom(), 1));
  const reset = zoom.setZoom(ZOOM_DEFAULT);
  expect(zoom.wantedZoom()).toBe(ZOOM_DEFAULT);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending.shift()!();
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending.shift()!();
  await Promise.all([step, twice, reset]);

  // The first step is on its way when the others come; only the last is sent after it.
  expect(applied).toEqual([1.1, ZOOM_DEFAULT]);
  expect(worn).toEqual([1.1, ZOOM_DEFAULT]);
  expect(zoom.currentZoom()).toBe(ZOOM_DEFAULT);
  expect(localStorage.getItem(ZOOM_KEY)).toBe(String(ZOOM_DEFAULT));
});

test('a factor the webview refuses is neither kept nor stepped from', async () => {
  vi.resetModules();
  const zoom = await import('./zoom');
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  localStorage.setItem(ZOOM_KEY, '1');
  webview.setZoom = () => Promise.reject(new Error('webview.set_webview_zoom not allowed'));
  await expect(zoom.setZoom(1.1)).rejects.toThrow('not allowed');
  expect(localStorage.getItem(ZOOM_KEY)).toBe('1');
  expect(zoom.wantedZoom()).toBe(ZOOM_DEFAULT);
  expect(zoom.currentZoom()).toBe(ZOOM_DEFAULT);
});

test('two quick steps walk two rungs', async () => {
  vi.resetModules();
  const zoom = await import('./zoom');
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  webview.setZoom = () => new Promise((resolve) => setTimeout(resolve, 5));
  await Promise.all([zoom.setZoom(zoom.stepZoom(zoom.wantedZoom(), 1)), zoom.setZoom(zoom.stepZoom(zoom.wantedZoom(), 1))]);
  expect(zoom.currentZoom()).toBe(1.25);
});

test('a wheel notch walks one rung, and a pinch walks one per notch it adds up to', () => {
  const step = wheelSteps();
  // One notch up enlarges at once, one down shrinks at once, wherever the turn was.
  expect(step({ deltaY: -100, deltaMode: 0, timeStamp: 0 })).toBe(1);
  expect(step({ deltaY: 100, deltaMode: 0, timeStamp: 10 })).toBe(-1);
  // A notch a second, or three lines each quickly: one rung for each.
  expect(step({ deltaY: 100, deltaMode: 0, timeStamp: 1000 })).toBe(-1);
  expect(step({ deltaY: 3, deltaMode: 1, timeStamp: 1050 })).toBe(-1);
  // A pinch: its first small delta steps, the next ones wait for a notch's worth.
  const pinch = [-4, -6, -5, -8, -7, -10, -9, -12, -11, -10, -9, -8, -6];
  const rungs = pinch.map((deltaY, at) => step({ deltaY, deltaMode: 0, timeStamp: 5000 + at * 16 })).filter(Boolean);
  expect(rungs).toEqual([1, 1]);
  expect(step({ deltaY: 0, deltaMode: 0, timeStamp: 6000 })).toBeNull();
});

test('Ctrl with the wheel zooms the interface in the shell, before anything under the pointer scrolls', async () => {
  vi.resetModules();
  const fresh = await import('./zoom');
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  webview.setZoom = () => Promise.resolve();
  const failed = vi.fn();
  const stop = fresh.watchZoomWheel(failed);
  const list = document.body.appendChild(document.createElement('div'));
  const picture = document.body.appendChild(document.createElement('div'));
  picture.dataset.wheelZoom = '';
  const scrolled = vi.fn();
  list.addEventListener('wheel', scrolled);
  picture.addEventListener('wheel', scrolled);
  const wheel = (on: Element, init: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    on.dispatchEvent(event);
    return event;
  };
  try {
    // Ctrl held: the wheel is the zoom's, cancelled and kept from the list.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    expect(wheel(list, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(fresh.currentZoom()).toBe(1.1));
    expect(localStorage.getItem(ZOOM_KEY)).toBe('1.1');
    expect(scrolled).not.toHaveBeenCalled();
    // A picture that zooms itself keeps its Ctrl wheel.
    expect(wheel(picture, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(scrolled).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
    // A plain wheel scrolls, and the listener no longer cancels.
    expect(wheel(list, { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(scrolled).toHaveBeenCalledTimes(2);
    // A pinch comes with no key down: its first delta zooms without cancelling, the next ones are cancelled.
    expect(wheel(list, { deltaY: 3, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(list, { deltaY: 3, ctrlKey: true }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(fresh.currentZoom()).toBe(ZOOM_DEFAULT));
    expect(scrolled).toHaveBeenCalledTimes(2);
    // The next plain wheel lets go.
    expect(wheel(list, { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(wheel(list, { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    stop();
    list.remove();
    picture.remove();
  }
});

test('outside the shell Ctrl with the wheel is the browser\'s', async () => {
  vi.resetModules();
  const fresh = await import('./zoom');
  const stop = fresh.watchZoomWheel(() => undefined);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
  document.body.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(fresh.wantedZoom()).toBe(ZOOM_DEFAULT);
  stop();
});
