import { expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { store } from '../lib/store.svelte';
import { mountOnFake, test, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

const installed = '[data-testid=mcp-installed]';
const form = '[data-testid=mcp-form]';
const text = (selector: string): string => document.querySelector(selector)?.textContent ?? '';
const click = (selector: string): void => document.querySelector<HTMLElement>(selector)!.click();

test('MCP settings follow fake-core changes, render test tools and keep saved credentials masked', async ({ app: _app }) => {
  const client = store.client!;
  const savedHeaders: Record<string, string | null | undefined>[] = [];
  let failNextToggle = false;
  const origCall = client.call.bind(client);
  client.call = ((method: string, params: Record<string, unknown>) => {
    if (method === 'mcp.save') savedHeaders.push((params.secretHeaders as Record<string, string | null | undefined>) ?? {});
    if (method === 'mcp.toggle' && failNextToggle) {
      failNextToggle = false;
      return Promise.reject(new Error('transient toggle failure'));
    }
    return origCall(method as never, params as never);
  }) as typeof client.call;
  store.showSettings('mcp');
  flushSync();
  await waitFor(() => !!document.querySelector('[data-testid=mcp-catalog]'));
  expect(document.querySelectorAll('[data-testid=mcp-catalog] .preset')).toHaveLength(9);
  click('[aria-label="Add GitHub"]');
  await waitFor(() => !!document.querySelector(form));
  const secret = document.querySelector<HTMLInputElement>(form + ' input[type=password]')!;
  expect(secret.placeholder).toContain('Bearer');
  secret.value = 'synthetic-ui-credential';
  secret.dispatchEvent(new Event('input', { bubbles: true }));
  click(form + ' button[type=submit]');
  await waitFor(() => text(installed).includes('GitHub'));
  expect(document.querySelector(form)).toBeNull();
  expect(savedHeaders[0]).toEqual({ Authorization: 'Bearer synthetic-ui-credential' });
  const { servers } = await client.call('mcp.list', {});
  expect(servers[0]).toMatchObject({ id: 'github', transport: 'http', secretHeaderKeys: ['Authorization'], headers: {} });
  expect(JSON.stringify(servers)).not.toContain(secret.value);
  click('[aria-label="Test GitHub"]');
  await waitFor(() => text('[data-testid=mcp-probe]').includes('example_tool'));
  expect(text('[data-testid=mcp-probe] summary')).toContain('1 tool');
  const actions = [...document.querySelectorAll<HTMLButtonElement>(installed + ' .server-actions button')];
  actions.find(button => button.textContent?.includes('Edit'))!.click();
  await waitFor(() => text(form).includes('Saved'));
  expect(document.querySelector<HTMLInputElement>(form + ' input[type=password]')?.value).toBe('');
  await client.call('mcp.toggle', { id: 'github', enabled: false });
  await waitFor(() => document.querySelector<HTMLInputElement>(installed + ' [role=switch]')?.checked === false);
  click(form + ' button[type=submit]');
  await waitFor(() => !document.querySelector(form));
  expect((await client.call('mcp.list', {})).servers[0]).toMatchObject({ enabled: false, secretHeaderKeys: ['Authorization'] });
  // Pasting an already-prefixed Bearer token does not double-prefix it.
  click('[aria-label="Add Linear"]');
  await waitFor(() => !!document.querySelector(form));
  const linearSecret = document.querySelector<HTMLInputElement>(form + ' input[type=password]')!;
  linearSecret.value = 'Bearer already-prefixed-token';
  linearSecret.dispatchEvent(new Event('input', { bubbles: true }));
  click(form + ' button[type=submit]');
  await waitFor(() => text(installed).includes('Linear'));
  expect(savedHeaders.at(-1)).toEqual({ Authorization: 'Bearer already-prefixed-token' });
  // A transient page-level error clears after the next successful action.
  failNextToggle = true;
  click(installed + ' [role=switch]');
  await waitFor(() => text('[data-testid=mcp-page] [role=alert]').includes('transient toggle failure'));
  click(installed + ' [role=switch]');
  await waitFor(() => !document.querySelector('[data-testid=mcp-page] [role=alert]'));
  [...document.querySelectorAll<HTMLButtonElement>(installed + ' .server-actions button')]
    .find(button => button.textContent?.includes('Remove'))!.click();
  await waitFor(() => !!document.querySelector('[data-testid=confirm-dialog]'));
  click('[data-testid=confirm-ok]');
  await waitFor(() => !text(installed).includes('GitHub'));
  await client.call('mcp.remove', { id: 'linear' });
  await waitFor(() => !text(installed).includes('Linear'));
  expect((await client.call('mcp.list', {})).servers).toEqual([]);
});

test('MCP settings warn when changing origin and handle a server named constructor', async ({ app: _app }) => {
  store.showSettings('mcp');
  const client = store.client!;
  await client.call('mcp.save', {
    name: 'constructor', enabled: true, scope: 'global', projectIds: [], transport: 'http',
    url: 'https://one.example.test/mcp', secretHeaders: { Authorization: 'fixture-http-credential' },
  });
  await waitFor(() => text(installed).includes('constructor'));
  expect(document.querySelector(installed + ' .server-icon svg')).not.toBeNull();
  const testButton = document.querySelector<HTMLButtonElement>('[aria-label="Test constructor"]')!;
  expect(testButton.disabled).toBe(false);
  testButton.click();
  await waitFor(() => text('[data-testid=mcp-probe]').includes('example_tool'));
  click(installed + ' .server-actions button:nth-child(2)');
  await waitFor(() => text(form).includes('Saved'));
  const url = document.querySelector<HTMLInputElement>(form + ' input[type=url]')!;
  const setUrl = (value: string) => {
    url.value = value;
    url.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };
  setUrl('https://one.example.test/other');
  expect(text(form)).not.toContain('Saving clears');
  setUrl('https://one.example.test:8443/other');
  expect(text(form)).toContain('Saving clears');
  expect(document.querySelector(form + ' .saved')).toBeNull();
  click(form + ' button[type=submit]');
  await waitFor(() => !document.querySelector(form));
  expect((await client.call('mcp.list', {})).servers[0]).toMatchObject({ url: 'https://one.example.test:8443/other', secretHeaderKeys: [] });
});

test('MCP edits distinguish environment keys by case on a Linux core', async () => {
  await mountOnFake('/?fake=1&os=linux');
  const client = store.client!;
  const saved = await client.call('mcp.save', {
    name: 'Local fixture', enabled: true, transport: 'stdio', command: 'fixture-mcp', args: [], scope: 'global', projectIds: [],
    env: { token: 'plain-fixture' }, secretEnv: { TOKEN: 'secret-fixture' },
  });
  store.showSettings('mcp');
  await waitFor(() => text(installed).includes(saved.name));
  click(installed + ' .server-actions button:nth-child(2)');
  await waitFor(() => text(form).includes('Saved'));
  click(form + ' button[type=submit]');
  await waitFor(() => !document.querySelector(form));
  expect((await client.call('mcp.list', {})).servers[0]).toMatchObject({ env: { token: 'plain-fixture' }, secretEnvKeys: ['TOKEN'] });
});

test('McpPage refuses to submit secrets over an unencrypted link and fake-client enforces the same refusal', async () => {
  await mountOnFake('/?fake=1&plainLink=1');
  const client = store.client!;
  expect((await client.call('mcp.list', {})).encrypted).toBe(false);
  await expect(client.call('mcp.save', {
    name: 'Direct', enabled: true, transport: 'stdio', command: 'npx', args: [], scope: 'global', projectIds: [],
    env: {}, secretEnv: { TOKEN: 'secret-value' }, headers: {}, secretHeaders: {},
  })).rejects.toThrow(/encrypted link/);
  const plainSaved = await client.call('mcp.save', {
    name: 'Plain Delete', enabled: true, transport: 'stdio', command: 'npx', args: [], scope: 'global', projectIds: [],
    env: {}, secretEnv: { TOKEN: null }, headers: {}, secretHeaders: {},
  });
  expect(plainSaved.secretEnvKeys).toEqual([]);
  const saves: unknown[] = [];
  const call = client.call.bind(client);
  client.call = ((method: string, params: unknown) => {
    if (method === 'mcp.save') saves.push(params);
    return call(method as never, params as never);
  }) as typeof client.call;
  store.showSettings('mcp');
  flushSync();
  await waitFor(() => !!document.querySelector('[data-testid=mcp-catalog]'));
  click('[aria-label="Add GitHub"]');
  await waitFor(() => !!document.querySelector(form));
  expect(text(form)).toContain('encrypted connection');
  const token = document.querySelector<HTMLInputElement>(form + ' input[type=password]')!;
  token.value = 'ghp_never_leave_browser';
  token.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  click(form + ' button[type=submit]');
  await waitFor(() => !!document.querySelector(form + ' .error'));
  expect(text(form + ' .error')).toContain('encrypted connection');
  expect(saves).toEqual([]);
});

test('adding the same catalog preset a second time chooses a unique default name', async ({ app: _app }) => {
  store.showSettings('mcp');
  flushSync();
  await waitFor(() => !!document.querySelector('[data-testid=mcp-catalog]'));
  click('[aria-label="Add Fetch"]');
  await waitFor(() => !!document.querySelector(form));
  click(form + ' button[type=submit]');
  await waitFor(() => !document.querySelector(form));
  click('[aria-label="Add Fetch"]');
  await waitFor(() => text(form).includes('Fetch 2'));
  click(form + ' button[type=submit]');
  await waitFor(() => !document.querySelector(form));
  expect((await store.client!.call('mcp.list', {})).servers.map(server => server.id)).toEqual(['fetch', 'fetch-2']);
});
