import { afterEach, expect, test, vi } from 'vitest';
import { holdSettingsCard } from './settings-flash';

let frames: FrameRequestCallback[] = [];
const runFrame = () => { const queue = frames; frames = []; for (const callback of queue) callback(0); };

afterEach(() => {
  document.body.innerHTML = '';
  frames = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Diagnostics above the task manager in one scroller; `top` is where the section sits, as the page above grows. */
function page() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  document.body.innerHTML = '<div class="framed" style="overflow-y: auto"><div class="page">Diagnostics</div><div id="settings-task-manager">Task manager</div></div>';
  const scroller = document.querySelector<HTMLElement>('.framed')!;
  const target = document.getElementById('settings-task-manager')!;
  const place = { top: 0 };
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, place.top - scroller.scrollTop, 800, 600));
  return { scroller, place };
}

test('the task manager stays at the top while Diagnostics above it fills in', () => {
  const { scroller, place } = page();
  place.top = 900;
  scroller.scrollTop = 900;
  holdSettingsCard('task-manager');
  runFrame();
  expect(scroller.scrollTop).toBe(900);
  // The log lands and the page above grows by 400 px: the section is brought back to the top.
  place.top = 1300;
  runFrame();
  expect(scroller.scrollTop).toBe(1300);
});

test('the reader scrolling lets the section go', () => {
  const { scroller, place } = page();
  place.top = 900;
  scroller.scrollTop = 900;
  holdSettingsCard('task-manager');
  window.dispatchEvent(new Event('wheel'));
  place.top = 1300;
  runFrame();
  expect(frames).toHaveLength(0);
  expect(scroller.scrollTop).toBe(900);
});
