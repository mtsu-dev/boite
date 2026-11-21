import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import AutoGoalSetting from './AutoGoalSetting.svelte';
import type { Store } from '../lib/store.svelte';

let running: Record<string, unknown> | null = null;
afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
});

const settle = async () => { for (let i = 0; i < 5; i++) { flushSync(); await tick(); } };
const query = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
};

test('automatic goals are off by default; the threshold row sits under the switch, saves a valid length, and goes with the switch', async () => {
  const saved: unknown[] = [];
  const store = $state({ owner: true, settings: {} as Record<string, unknown>, saveSettings: async (patch: Record<string, unknown>) => { saved.push(patch); store.settings = { ...store.settings, ...patch }; return true; } });
  running = mount(AutoGoalSetting, { target: document.body, props: { store: store as unknown as Store } });
  await settle();
  const toggle = query<HTMLInputElement>('[data-testid=setting-auto-goals]');
  expect(toggle.checked).toBe(false);
  expect(toggle.closest('label')?.textContent).toContain('Automatic goals');
  // A missing key is off: no threshold to set until the owner turns them on.
  expect(document.querySelector('[data-testid=auto-goal-settings]')).toBeNull();
  toggle.click();
  await settle();
  expect(saved).toEqual([{ autoGoals: true }]);
  expect(toggle.checked).toBe(true);
  saved.length = 0;
  const row = query('[data-testid=auto-goal-settings]');
  expect(toggle.closest('label')!.nextElementSibling).toBe(row);
  const field = query<HTMLInputElement>('[data-testid=auto-goal-min-chars]');
  expect(field.value).toBe('1500');
  expect(row.textContent).toContain('Prompt length');

  field.value = '150';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(query('[data-testid=auto-goal-min-chars-error]').textContent).toContain('200 to 20000');
  expect(saved).toEqual([]);

  field.value = '800';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(saved).toEqual([{ autoGoalMinChars: 800 }]);

  // Off, the machine starts no automatic goal and the threshold has nothing to say.
  toggle.click();
  await settle();
  expect(saved.at(-1)).toEqual({ autoGoals: false });
  expect(document.querySelector('[data-testid=auto-goal-settings]')).toBeNull();
});

test('a refused switch goes back, and a paired device sees neither the switch nor the threshold', async () => {
  const store = { owner: true, settings: { autoGoals: true }, saveSettings: async () => false };
  running = mount(AutoGoalSetting, { target: document.body, props: { store: store as unknown as Store } });
  await settle();
  const toggle = query<HTMLInputElement>('[data-testid=setting-auto-goals]');
  expect(toggle.checked).toBe(true);
  toggle.click();
  await settle();
  expect(toggle.checked).toBe(true);
  unmount(running, { outro: false });
  running = mount(AutoGoalSetting, { target: document.body, props: { store: { ...store, owner: false } as unknown as Store } });
  await settle();
  expect(document.querySelector('[data-testid=setting-auto-goals]')).toBeNull();
  expect(document.querySelector('[data-testid=auto-goal-settings]')).toBeNull();
});
