import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PickerChoices from './PickerChoices.svelte';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
});

const items = [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }, { id: 'ultrathink', label: 'Ultra', title: 'ultrathink' }];

function press(key: string): boolean {
  return (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

test('the row shows the current choice, unfolds one checked row per choice and folds back on a pick or Escape', async () => {
  const picks: string[] = [];
  let active = $state('high');
  running = mount(PickerChoices, { target: document.body, props: { label: 'Effort', testid: 'effort-menu', items, segmented: false, get active() { return active; }, onpick: (id: string) => { picks.push(id); active = id; } } });
  flushSync();
  const trigger = document.querySelector<HTMLButtonElement>('[data-choices-trigger]')!;
  const list = document.querySelector<HTMLElement>('[data-testid=effort-menu]')!;
  expect(trigger.textContent?.trim()).toBe('High');
  expect(trigger.getAttribute('aria-label')).toBe('Effort: High');
  // Folded, the choices stay in the page for `reveal` but are hidden.
  expect(list.hidden).toBe(true);
  expect(list.querySelectorAll('[data-value]')).toHaveLength(3);

  trigger.click();
  flushSync();
  await Promise.resolve();
  expect(list.hidden).toBe(false);
  expect((document.activeElement as HTMLElement).dataset.value).toBe('high');
  expect(list.querySelectorAll('[aria-checked=true] .mark svg')).toHaveLength(1);

  // Left and right step a level like up and down, and the pick saves at once.
  expect(press('ArrowLeft')).toBe(false);
  flushSync();
  expect(picks).toEqual(['low']);
  expect(press('ArrowRight')).toBe(false);
  flushSync();
  expect(picks).toEqual(['low', 'high']);
  expect(list.hidden).toBe(false);

  press('Escape');
  flushSync();
  expect(list.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);

  trigger.click();
  flushSync();
  list.querySelector<HTMLButtonElement>('[data-value=ultrathink]')!.click();
  flushSync();
  expect(picks).toEqual(['low', 'high', 'ultrathink']);
  expect(list.hidden).toBe(true);
  expect(trigger.textContent?.trim()).toBe('Ultra');
  expect(trigger.title).toBe('ultrathink');
});

test('short choices are one segmented row: every choice in view, no fold, the arrows pick in place', () => {
  const picks: string[] = [];
  let active = $state('high');
  running = mount(PickerChoices, { target: document.body, props: { label: 'Effort', testid: 'effort-menu', items, get active() { return active; }, onpick: (id: string) => { picks.push(id); active = id; } } });
  flushSync();
  // No list nested in the popover: nothing to unfold, every choice drawn.
  expect(document.querySelector('[data-choices-trigger]')).toBeNull();
  const group = document.querySelector<HTMLElement>('[data-testid=effort-menu]')!;
  expect(group.hidden).toBe(false);
  expect(Array.from(group.querySelectorAll<HTMLElement>('[role=radio]')).map((el) => el.textContent?.trim())).toEqual(['Low', 'High', 'Ultra']);
  // The live one is the row the picker's keys stop on, once.
  const live = group.querySelector<HTMLElement>('[aria-checked=true]')!;
  expect(live.dataset.value).toBe('high');
  expect(group.querySelectorAll('[data-row]')).toHaveLength(1);
  live.focus();
  expect(press('ArrowRight')).toBe(false);
  flushSync();
  expect(picks).toEqual(['ultrathink']);
  expect((document.activeElement as HTMLElement).dataset.value).toBe('ultrathink');
  group.querySelector<HTMLButtonElement>('[data-value=low]')!.click();
  flushSync();
  expect(picks).toEqual(['ultrathink', 'low']);
  expect(group.querySelector('[aria-checked=true]')?.textContent?.trim()).toBe('Low');
});

test('a choice too long for a segment keeps the fold', () => {
  running = mount(PickerChoices, { target: document.body, props: { label: 'Permission', testid: 'mode-menu', items: [{ id: 'ask', label: 'Ask before edits and commands' }, { id: 'auto', label: 'Auto' }], active: 'ask', onpick: () => {} } });
  flushSync();
  expect(document.querySelector('[data-choices-trigger]')).not.toBeNull();
  expect(document.querySelector<HTMLElement>('[data-testid=mode-menu]')!.hidden).toBe(true);
});

// The model menu has the same rows on every width: a phone's effort is the same segmented row, a finger tall.
test('on a phone short choices are the same segmented row as on a desktop', () => {
  const width = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  try {
    running = mount(PickerChoices, { target: document.body, props: { label: 'Effort', testid: 'effort-menu', items, active: 'high', onpick: () => {} } });
    flushSync();
    expect(document.querySelector('.segments')).not.toBeNull();
    expect(document.querySelector('[data-choices-trigger]')).toBeNull();
  } finally {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  }
});
