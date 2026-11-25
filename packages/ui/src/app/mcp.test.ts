import { expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { store } from '../lib/store.svelte';
import { test, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

const installed = '[data-testid=mcp-installed]';
const form = '[data-testid=mcp-form]';
const text = (selector: string): string => document.querySelector(selector)?.textContent ?? '';
const click = (selector: string): void => document.querySelector<HTMLElement>(selector)!.click();

test('MCP settings follow fake-core changes, render test tools and keep saved credentials masked', async ({ app: _app }) => {
  store.showSettings('mcp');
  flushSync();
  await waitFor(() => !!document.querySelector('[data-testid=mcp-catalog]'));
  expect(document.querySelectorAll('[data-testid=mcp-catalog] .preset')).toHaveLength(9);
  click('[aria-label="Add GitHub"]');
  await waitFor(() => !!document.querySelector(form));
  const secret = document.querySelector<HTMLInputElement>(form + ' input[type=password]')!;
  secret.value = 'synthetic-ui-credential';
  secret.dispatchEvent(new Event('input', { bubbles: true }));
  click(form + ' button[type=submit]');
  await waitFor(() => text(installed).includes('GitHub'));
  expect(document.querySelector(form)).toBeNull();
  const { servers } = await store.client!.call('mcp.list', {});
  expect(servers[0]).toMatchObject({ id: 'github', secretEnvKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'], env: {} });
  expect(JSON.stringify(servers)).not.toContain(secret.value);
  click('[aria-label="Test GitHub"]');
  await waitFor(() => text('[data-testid=mcp-probe]').includes('example_tool'));
  expect(text('[data-testid=mcp-probe] summary')).toContain('1 tool');
  const actions = [...document.querySelectorAll<HTMLButtonElement>(installed + ' .server-actions button')];
  actions.find(button => button.textContent?.includes('Edit'))!.click();
  await waitFor(() => text(form).includes('Saved'));
  expect(document.querySelector<HTMLInputElement>(form + ' input[type=password]')?.value).toBe('');
  click(form + ' button[type=submit]');
  await waitFor(() => !document.querySelector(form));
  expect((await store.client!.call('mcp.list', {})).servers[0]?.secretEnvKeys).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN']);
  await store.client!.call('mcp.toggle', { id: 'github', enabled: false });
  await waitFor(() => document.querySelector<HTMLInputElement>(installed + ' [role=switch]')?.checked === false);
  [...document.querySelectorAll<HTMLButtonElement>(installed + ' .server-actions button')]
    .find(button => button.textContent?.includes('Remove'))!.click();
  await waitFor(() => !!document.querySelector('[data-testid=confirm-dialog]'));
  click('[data-testid=confirm-ok]');
  await waitFor(() => !text(installed).includes('GitHub'));
  expect((await store.client!.call('mcp.list', {})).servers).toEqual([]);
});
