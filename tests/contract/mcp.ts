import { RpcErrorCode } from '../../packages/contracts/src/index.ts';
import type { ContractEnv, Scenario } from './scenarios.ts';

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function refused(call: Promise<unknown>, code: number, field?: string): Promise<void> {
  let error: unknown = null;
  try { await call; } catch (caught) { error = caught; }
  check(error !== null, `expected code ${code}, the call succeeded`);
  const raw = error as { code?: number; data?: { field?: unknown }; rpc?: { code?: number; data?: { field?: unknown } } };
  const got = raw.rpc ?? raw;
  check(got.code === code, `expected code ${code}, got ${String(got.code)}`);
  if (field !== undefined) check(got.data?.field === field, `expected field ${field}, got ${String(got.data?.field)}`);
}

export const MCP_SCENARIOS: Record<string, Scenario> = {
  'mcp.* manages servers, validates params, emits mcp.changed, and refuses agent peers': async (env: ContractEnv) => {
    let changed = 0;
    const stop = env.on('mcp.changed', () => { changed += 1; });
    try {
      const initial = await env.call('mcp.list', {});
      check(initial.encrypted === true, 'loopback contract link must report encrypted: true');
      check(initial.presets.length > 0, 'mcp.list must include curated presets');

      const saved = await env.call('mcp.save', {
        name: 'Contract HTTP',
        transport: 'http',
        url: 'https://example.test/mcp',
        enabled: true,
        scope: 'global',
        projectIds: [],
        secretHeaders: { Authorization: 'Bearer contract-token' },
      });
      check(saved.id === 'contract-http', `expected slug id contract-http, got ${saved.id}`);
      check(saved.enabled === true, 'new MCP server should start enabled');
      check(saved.secretHeaderKeys.includes('Authorization'), 'saved MCP server should expose secret header key only');
      check(changed >= 1, 'mcp.save should emit mcp.changed');

      const toggled = await env.call('mcp.toggle', { id: saved.id, enabled: false });
      check(toggled.enabled === false, 'mcp.toggle should disable the server');
      const edited = await env.call('mcp.save', {
        id: saved.id, name: 'Edited HTTP', transport: 'http', url: saved.url, scope: 'global', projectIds: [],
      });
      check(edited.enabled === false && edited.name === 'Edited HTTP', 'editing a disabled server should keep it disabled');
      await refused(env.call('mcp.save', { ...edited, enabled: null as unknown as boolean }), RpcErrorCode.InvalidParams, 'enabled');
      await refused(env.call('mcp.toggle', { id: saved.id, enabled: 'yes' as unknown as boolean }), RpcErrorCode.InvalidParams, 'enabled');
      await refused(env.call('mcp.toggle', { id: 'missing-server', enabled: true }), RpcErrorCode.InvalidParams, 'id');
      await refused(env.call('mcp.test', { id: 'missing-server' }), RpcErrorCode.InvalidParams, 'id');

      const account = (await env.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
      const project = await env.call('projects.add', { path: await env.newFolder(), name: 'MCP contract' });
      const thread = await env.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Agent peer' });
      const agent = await env.peer({ agentThreadId: thread.id });
      await refused(agent.call('mcp.list', {}), RpcErrorCode.Refused);
      await refused(agent.call('mcp.save', { name: 'Denied', transport: 'http', url: 'https://example.test/mcp', enabled: true, scope: 'global', projectIds: [] }), RpcErrorCode.Refused);
      await refused(agent.call('mcp.toggle', { id: saved.id, enabled: true }), RpcErrorCode.Refused);
      await refused(agent.call('mcp.test', { id: saved.id }), RpcErrorCode.Refused);
      await refused(agent.call('mcp.remove', { id: saved.id }), RpcErrorCode.Refused);

      const removed = await env.call('mcp.remove', { id: saved.id });
      check(removed.removed === true, 'mcp.remove should report removed: true');
      await refused(env.call('mcp.remove', { id: saved.id }), RpcErrorCode.InvalidParams, 'id');
    } finally {
      stop();
    }
  },
};
