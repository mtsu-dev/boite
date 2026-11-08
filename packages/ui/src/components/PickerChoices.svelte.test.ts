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
  running = mount(PickerChoices, { target: document.body, props: { label: 'Effort', testid: 'effort-menu', items, get active() { return active; }, onpick: (id: string) => { picks.push(id); active = id; } } });
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
