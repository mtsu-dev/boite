import { afterEach, expect, test, vi } from 'vitest';
import { PRESS_GRACE_MS, startPressPreload } from './press-preload';

function press(target: Element, type: string, init: { pointerId?: number; button?: number; pointerType?: string; clientX?: number; isPrimary?: boolean } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, clientX: init.clientX });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    isPrimary: { value: init.isPrimary ?? true },
    pointerType: { value: init.pointerType ?? 'mouse' }
  });
  target.dispatchEvent(event);
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
});

test('re-pressing a row shares its preload, but a drag or release away gives it back immediately', () => {
  document.body.innerHTML = '<button data-preload-thread="t-1">row</button><div>outside</div>';
  const row = document.querySelector('button')!;
  const outside = document.querySelector('div')!;
  const release = vi.fn();
  const store = { preload: vi.fn(() => release) };
  const stop = startPressPreload({ machines: [], active: store });
  try {
    press(row, 'pointerdown');
    press(row, 'pointerup');
    press(row, 'pointerdown');
    expect(store.preload).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    press(row, 'pointermove', { clientX: 11, pointerId: 2 });
    expect(release).not.toHaveBeenCalled();
    press(row, 'pointermove', { clientX: 11 });
    expect(release).toHaveBeenCalledTimes(1);
    press(row, 'pointerdown');
    press(outside, 'pointerup');
    expect(release).toHaveBeenCalledTimes(2);
    press(row, 'pointerdown');
    press(outside, 'pointerdown');
    expect(release).toHaveBeenCalledTimes(3);
    press(row, 'pointerdown', { pointerType: 'touch' });
    press(row, 'pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: false });
    expect(release).toHaveBeenCalledTimes(4);
  } finally { stop(); }
});

test('a press preloads on the owning machine, a click inside the grace keeps it, a cancel or a stray release gives it back', () => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  document.body.innerHTML = `
    <button id="local" data-preload-thread="t-1"><span id="inner">row</span></button>
    <div data-machine-id="m-2"><button id="remote" data-machine-id="m-2" data-preload-thread="t-9">row</button></div>
    <button id="gone" data-machine-id="m-left" data-preload-thread="t-1">row of a machine that left</button>
    <button id="plain">nothing</button>`;
  const released: string[] = [];
  const preloaded: string[] = [];
  const machine = (name: string) => ({ preload: (id: string) => { preloaded.push(`${name}:${id}`); return () => released.push(`${name}:${id}`); } });
  const stop = startPressPreload({ machines: [{ id: 'm-1', store: machine('m-1') }, { id: 'm-2', store: machine('m-2') }], active: machine('m-1') });
  try {
    press(document.getElementById('inner')!, 'pointerdown');
    expect(preloaded).toEqual(['m-1:t-1']);
    press(document.getElementById('inner')!, 'pointerup');
    vi.advanceTimersByTime(PRESS_GRACE_MS - 1);
    expect(released).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(released).toEqual(['m-1:t-1']);

    // A row of another machine goes to that machine's store; a scroll that takes the finger over gives it back at once.
    press(document.getElementById('remote')!, 'pointerdown', { pointerId: 2, pointerType: 'touch' });
    expect(preloaded.at(-1)).toBe('m-2:t-9');
    press(document.getElementById('remote')!, 'pointercancel', { pointerId: 2 });
    expect(released.at(-1)).toBe('m-2:t-9');

    // A secondary button, an unmarked element, a machine no longer connected and a driven browser ask for nothing.
    press(document.getElementById('local')!, 'pointerdown', { button: 2 });
    press(document.getElementById('plain')!, 'pointerdown');
    press(document.getElementById('gone')!, 'pointerdown');
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    press(document.getElementById('local')!, 'pointerdown');
    expect(preloaded).toEqual(['m-1:t-1', 'm-2:t-9']);
    window.__BOITE_PRESS_PRELOAD_TEST__ = true;
    press(document.getElementById('local')!, 'pointerdown');
    expect(preloaded.at(-1)).toBe('m-1:t-1');
  } finally {
    delete window.__BOITE_PRESS_PRELOAD_TEST__;
    stop();
  }
  // Stopping the experiment releases the press still held.
  expect(released.at(-1)).toBe('m-1:t-1');
  press(document.getElementById('local')!, 'pointerdown');
  expect(preloaded).toHaveLength(3);
});

test('a button carrying both data-preload-view and data-preload-thread warms the thread alongside the view', () => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  document.body.innerHTML = `<button id="bot" data-machine-id="m-1" data-preload-view="agents" data-preload-thread="t-bot">Mochi</button>`;
  const preloaded: string[] = [];
  const released: string[] = [];
  const store = { preload: (id: string) => { preloaded.push(id); return () => released.push(id); } };
  const stop = startPressPreload({ machines: [{ id: 'm-1', store }], active: store });
  try {
    press(document.getElementById('bot')!, 'pointerdown');
    expect(preloaded).toEqual(['t-bot']);
    press(document.getElementById('bot')!, 'pointercancel');
    expect(released).toEqual(['t-bot']);
  } finally {
    stop();
  }
});

test('pressing the subagents tab warms the lightweight view on its owning machine', () => {
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  document.body.innerHTML = '<button data-machine-id="remote" data-preload-view="panel-agents">Subagents</button>';
  const active = { preload: vi.fn(), loadDelegation: vi.fn(), openThread: { id: 'local-thread' } };
  const remote = { preload: vi.fn(), loadDelegation: vi.fn(), openThread: { id: 'remote-thread' } };
  const stop = startPressPreload({ machines: [{ id: 'remote', store: remote }], active });
  try {
    press(document.querySelector('button')!, 'pointerdown');
    expect(remote.loadDelegation).toHaveBeenCalledWith('remote-thread', { join: true });
    expect(active.loadDelegation).not.toHaveBeenCalled();
    expect(remote.preload).not.toHaveBeenCalled();
  } finally { stop(); }
});
