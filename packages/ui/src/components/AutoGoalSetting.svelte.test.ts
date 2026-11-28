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

test('the prompt length saves only within the allowed range', async () => {
  const saved: unknown[] = [];
  const store = $state({ owner: true, settings: { autoGoals: true } as Record<string, unknown>, saveSettings: async (patch: Record<string, unknown>) => { saved.push(patch); store.settings = { ...store.settings, ...patch }; return true; } });
  running = mount(AutoGoalSetting, { target: document.body, props: { store: store as unknown as Store } });
  await settle();
  const row = query('[data-testid=auto-goal-settings]');
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
});

test('a paired device cannot edit the prompt length', async () => {
  const store = { owner: false, settings: { autoGoals: true } } as unknown as Store;
  running = mount(AutoGoalSetting, { target: document.body, props: { store } });
  await settle();
  expect(document.querySelector('[data-testid=auto-goal-settings]')).toBeNull();
});
