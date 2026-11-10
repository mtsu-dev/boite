import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SubscriptionProxy } from '@boite/contracts';
import { MANAGEMENT_TOKEN_SETTING } from '../src/douane-admin.ts';
import { startTestCore, type TestCore } from './harness.ts';
import { rejection } from './settle.ts';

const FAKE = join(import.meta.dir, 'fixtures', 'fake-douane.ts');
const TOKEN = 'management-token-4242';

let harness: TestCore | undefined;
let douane: { process: ReturnType<typeof Bun.spawn>; dir: string } | undefined;
afterEach(async () => {
  await harness?.stop(); harness = undefined;
  if (douane) { douane.process.kill(); await douane.process.exited; rmSync(douane.dir, { recursive: true, force: true }); }
  douane = undefined;
});

function freePort(): number {
  const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

/** The fake Douane on a port of its own, and a core whose gateway it is. */
async function start(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boite-fake-douane-'));
  const port = freePort();
  writeFileSync(join(dir, 'douane.toml'), `listen = "127.0.0.1:${port}"\n`);
  const child = Bun.spawn([process.execPath, FAKE, '--config', join(dir, 'douane.toml')], { env: { ...process.env, ...env }, stdout: 'ignore', stderr: 'inherit' });
  douane = { process: child, dir };
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (await fetch(`${url}/health`).then(response => response.ok, () => false)) break;
    if (Date.now() > deadline) throw new Error('the fake Douane did not start');
    await Bun.sleep(25);
  }
  const proxy: SubscriptionProxy = { enabled: true, kind: 'douane', baseUrl: url, dashboardUrl: `${url}/admin/#quotas` };
  harness = await startTestCore({ settings: { subscriptionProxy: proxy } });
  const client = await harness.connect();
  const writes = async () => ((await (await fetch(`${url}/debug/writes`)).json()) as { writes: { method: string; path: string; body: unknown }[] }).writes;
  return { url, client, writes };
}

test('the order reads each provider\'s strategy, spared families and accounts, and writes them back to Douane', async () => {
  const { url, client, writes } = await start();
  const order = await client.call('subscriptionProxy.order', {});
  expect(order).toMatchObject({ status: 'ready', origin: url, managementToken: false });
  const claude = order.providers.find(provider => provider.providerId === 'claude')!;
  expect(claude).toMatchObject({ name: 'Claude', strategy: 'reset-first', spareFamilies: [] });
  // Never ordered: by id. A name first, else the address without its domain, else the id.
  expect(claude.accounts).toEqual([
    { id: 'c1bb', name: 'chris@…', position: null, enabled: true },
    { id: 'c2cc', name: 'c2cc', position: null, enabled: false },
    { id: 'c3aa', name: 'Magali', position: null, enabled: true },
  ]);
  expect(JSON.stringify(order)).not.toContain('example.test');

  const mine = await client.call('subscriptionProxy.setOrder', { providerId: 'claude', strategy: 'fill-first', ids: ['c3aa', 'c1bb', 'c2cc'] });
  const after = mine.providers.find(provider => provider.providerId === 'claude')!;
  expect(after.strategy).toBe('fill-first');
  expect(after.accounts.map(account => [account.id, account.position])).toEqual([['c3aa', 0], ['c1bb', 1], ['c2cc', 2]]);
  // The other providers' strategies go back with this one: Douane replaces the map whole.
  expect(mine.providers.find(provider => provider.providerId === 'codex')!.strategy).toBe('reset-first');

  const spared = await client.call('subscriptionProxy.setOrder', { providerId: 'claude', spareFamilies: ['fable'] });
  expect(spared.providers.find(provider => provider.providerId === 'claude')!.spareFamilies).toEqual(['fable']);
  const cleared = await client.call('subscriptionProxy.setOrder', { providerId: 'claude', spareFamilies: [] });
  expect(cleared.providers.find(provider => provider.providerId === 'claude')!.spareFamilies).toEqual([]);

  expect(await writes()).toEqual([
    { method: 'PUT', path: '/admin/api/accounts/order', body: { provider: 'claude', ids: ['c3aa', 'c1bb', 'c2cc'] } },
    { method: 'PATCH', path: '/admin/api/settings', body: { provider_strategies: { claude: 'fill-first', codex: 'reset-first' } } },
    { method: 'PATCH', path: '/admin/api/settings', body: { spare_families: { claude: ['fable'] } } },
    { method: 'PATCH', path: '/admin/api/settings', body: { spare_families: {} } },
  ]);
});

test('a write Douane refuses says why, and a bad change never reaches it', async () => {
  const { client, writes } = await start();
  const refusal = (await rejection(client.call('subscriptionProxy.setOrder', { providerId: 'claude', ids: ['c3aa', 'c1bb'] }))).reason;
  expect(refusal).toMatchObject({ rpc: { message: expect.stringContaining('ids must list every claude account exactly once') } });
  expect((await client.call('subscriptionProxy.order', {})).providers[0]!.accounts.every(account => account.position === null)).toBe(true);
  const sent = (await writes()).length;
  for (const bad of [
    { providerId: 'claude' }, { providerId: 'Claude!', strategy: 'fill-first' }, { providerId: 'claude', strategy: 'smart' },
    { providerId: 'claude', ids: ['c1bb', 'c1bb'] }, { providerId: 'claude', spareFamilies: ['Fable 5'] },
  ]) {
    expect((await rejection(client.call('subscriptionProxy.setOrder', bad as never))).reason).toMatchObject({ rpc: { data: { field: expect.any(String) } } });
  }
  expect((await rejection(client.call('subscriptionProxy.setOrder', { providerId: 'grok', strategy: 'fill-first' }))).reason)
    .toMatchObject({ rpc: { message: expect.stringContaining('has no grok account') } });
  expect((await writes()).length).toBe(sent);
});

test('a Douane that wants a management token says so; the saved one is sent and appears in no answer, log or error', async () => {
  const { client } = await start({ FAKE_DOUANE_MANAGEMENT_KEY: TOKEN, FAKE_DOUANE_ECHO_KEY: '1' });
  const without = await client.call('subscriptionProxy.order', {});
  expect(without).toMatchObject({ status: 'needsToken', managementToken: false, providers: [] });
  expect((await rejection(client.call('subscriptionProxy.setOrder', { providerId: 'claude', strategy: 'fill-first' }))).reason)
    .toMatchObject({ rpc: { data: { field: 'managementToken' } } });

  harness!.core.journal.setSetting(MANAGEMENT_TOKEN_SETTING, TOKEN);
  const order = await client.call('subscriptionProxy.order', {});
  expect(order).toMatchObject({ status: 'ready', managementToken: true });
  const written = await client.call('subscriptionProxy.setOrder', { providerId: 'claude', strategy: 'fill-first', spareFamilies: ['fable'] });
  // A refusal that repeats the key it was sent reaches the client without it.
  const refusal = (await rejection(client.call('subscriptionProxy.setOrder', { providerId: 'claude', ids: ['c1bb'] }))).reason as { rpc: { message: string } };
  expect(refusal.rpc.message).toContain('asked with [hidden]');
  const logs = await client.call('core.logs', {});
  for (const seen of [without, order, written, refusal.rpc, logs]) expect(JSON.stringify(seen)).not.toContain(TOKEN);

  harness!.core.journal.setSetting(MANAGEMENT_TOKEN_SETTING, 'another-token');
  expect(await client.call('subscriptionProxy.order', {})).toMatchObject({ status: 'needsToken', managementToken: true });
});

test('a Douane that predates the account order shows nothing and takes no write; no Douane says so', async () => {
  const { url, client, writes } = await start({ FAKE_DOUANE_LEGACY: '1' });
  expect(await client.call('subscriptionProxy.order', {})).toMatchObject({ status: 'unsupported', providers: [] });
  expect((await rejection(client.call('subscriptionProxy.setOrder', { providerId: 'claude', strategy: 'fill-first' }))).reason)
    .toMatchObject({ rpc: { message: expect.stringContaining('update Douane') } });
  expect(await writes()).toEqual([]);

  await client.call('subscriptionProxy.configure', { subscriptionProxy: { enabled: true, kind: 'cliproxyapi', baseUrl: url, dashboardUrl: `${url}/management.html` } });
  expect(await client.call('subscriptionProxy.order', {})).toEqual({ status: 'noProxy', origin: null, managementToken: false, providers: [] });
  expect((await rejection(client.call('subscriptionProxy.setOrder', { providerId: 'claude', strategy: 'fill-first' }))).reason)
    .toMatchObject({ rpc: { data: { field: 'subscriptionProxy.kind' } } });
});
