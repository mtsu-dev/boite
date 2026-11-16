import { expect } from 'vitest';
import { maskEmail, type StateReading } from '@boite/contracts';
import { test } from '../../test/fake-client';

const read = <D extends StateReading['domain']>(value: StateReading, domain: D) => {
  expect(value.domain).toBe(domain);
  return value as Extract<StateReading, { domain: D }>;
};

test('agent.state reads the fake core\'s own quotas, threads, processes and gateway, as the core projects them', async ({ ready }) => {
  const { client } = await ready({ delayMs: 0 });
  const threadId = 'thr_state';
  const state = async <D extends StateReading['domain']>(domain: D) => read(await client.call('agent.state', { threadId, domain }), domain);

  const quotas = await client.call('quotas.list', {});
  expect(quotas.length).toBeGreaterThan(0);
  expect((await state('limits')).limits.map(limit => [limit.provider, limit.account])).toEqual(quotas.map(quota => [quota.providerName, maskEmail(quota.label)]));

  const resources = await client.call('resources.list', {});
  expect(resources.length).toBeGreaterThan(0);
  expect((await state('tasks')).tasks.map(task => task.threadId).sort()).toEqual(resources.map(row => row.threadId).sort());

  const providers = (await client.call('providers.list', {})).loaded;
  expect((await state('route')).route.providers.map(provider => provider.id)).toEqual(providers.map(provider => provider.id));

  const updates = (await state('updates')).updates.agents;
  expect(updates.length).toBeGreaterThan(0);

  const inbox = (await state('inbox')).inbox;
  expect(inbox.length).toBeGreaterThan(0);
  const threads = await client.call('threads.list', {});
  for (const row of inbox) expect(threads.some(thread => thread.id === row.threadId)).toBe(true);

  const summary = (await state('summary')).summary;
  expect(summary.limits.accounts).toBe(quotas.length);
  expect(summary.tasks.processes).toBe(resources.reduce((sum, row) => sum + row.load.processes, 0));
  expect(summary.inbox.needs + summary.inbox.updates).toBe(inbox.filter(row => !row.nested).length);
  expect(summary.updates.available).toBe(updates.filter(agent => agent.offered).length);
});
