import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PluginSetting } from '@boite/contracts';
import PluginSettingField from './PluginSettingField.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
});

test('a slider whose manifest gives no step keeps any value of its range, never one rounded to a whole number', async () => {
  const setting: PluginSetting = { key: 'ratio', type: 'slider', label: 'Ratio', default: 0.5, min: 0, max: 1 };
  const onsave = vi.fn(async () => null);
  mounted = mount(PluginSettingField, { target: document.body, props: { setting, value: 0.5, disabled: false, onsave } });
  flushSync();
  const input = document.querySelector<HTMLInputElement>('[data-testid="plugin-setting-input"]')!;
  expect(input.step).toBe('any');
  expect(input.value).toBe('0.5');
  input.value = '0.25';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(onsave).toHaveBeenCalledWith(0.25));
});
