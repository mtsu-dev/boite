import { RpcErrorCode, STATE_DOMAINS, type StateReading } from '../../packages/contracts/src/index.ts';
import type { ContractEnv, Scenario } from './scenarios.ts';

/* `agent.state` (`boite state`), the same on the real core and the in-memory client: what the user sees, read-only. */

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function refused(call: Promise<unknown>, code: number, field?: string): Promise<void> {
  let error: unknown = null;
  try { await call; } catch (caught) { error = caught; }
  check(error !== null, `expected code ${code}, the call succeeded`);
  const raw = error as { code?: number; data?: { field?: unknown }; rpc?: { code?: number; data?: { field?: unknown } } };
  const got = raw.rpc ?? raw;
  check(got.code === code, `expected code ${code}, got ${String(got.code)} (${error instanceof Error ? error.message : String(error)})`);
  if (field !== undefined) check(got.data?.field === field, `expected field ${field}, got ${String(got.data?.field)}`);
}

/** A full email anywhere in a reading: an account label must show only its first letter and domain. */
const FULL_EMAIL = /[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export const STATE_SCENARIOS: Record<string, Scenario> = {
  'agent.state answers each domain for its own thread, refuses another thread and an unknown domain, and shows no full email': async (env: ContractEnv) => {
    const account = (await env.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
    const project = await env.call('projects.add', { path: await env.newFolder(), name: 'State contract' });
    const own = await env.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Reads state' });
    const other = await env.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Another' });

    const readings = new Map<StateReading['domain'], StateReading>();
    for (const domain of STATE_DOMAINS) {
      const reading = await env.call('agent.state', { threadId: own.id, domain });
      check(reading.domain === domain, `${domain}: answered ${reading.domain}`);
      check(!FULL_EMAIL.test(JSON.stringify(reading)), `${domain}: a full email in ${JSON.stringify(reading).slice(0, 200)}`);
      readings.set(domain, reading);
    }
    await refused(env.call('agent.state', { threadId: own.id, domain: 'bogus' as never }), RpcErrorCode.InvalidParams, 'domain');

    // The summary counts what the domains list.
    const summary = (readings.get('summary') as Extract<StateReading, { domain: 'summary' }>).summary;
    const limits = (readings.get('limits') as Extract<StateReading, { domain: 'limits' }>).limits;
    const route = (readings.get('route') as Extract<StateReading, { domain: 'route' }>).route;
    const machines = (readings.get('machines') as Extract<StateReading, { domain: 'machines' }>).machines;
    check(summary.limits.accounts === limits.length, `summary counts ${summary.limits.accounts} accounts, limits lists ${limits.length}`);
    check(summary.route.providers === route.providers.filter(provider => provider.viaGateway).length, 'summary and route disagree on the gateway');
    check(summary.machines.total === machines.filter(machine => machine.kind === 'machine').length, 'summary and machines disagree on the machines');
    check(machines.filter(machine => machine.self).length === 1, 'exactly one machine is this one');
    const providers = (await env.call('providers.list', {})).loaded.map(provider => provider.id);
    check(JSON.stringify(route.providers.map(provider => provider.id)) === JSON.stringify(providers), 'the route lists the installed providers');

    // An agent reads it for its own thread only.
    const agent = await env.peer({ agentThreadId: own.id });
    check((await agent.call('agent.state', { threadId: own.id, domain: 'version' })).domain === 'version', 'an agent reads its own thread\'s state');
    await refused(agent.call('agent.state', { threadId: other.id, domain: 'version' }), RpcErrorCode.Refused);
  },
};
