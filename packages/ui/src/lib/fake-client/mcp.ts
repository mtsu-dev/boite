import { MCP_PRESETS, McpInputError, normalizeMcpServer, RpcErrorCode, type McpServer } from '@boite/contracts';
import { RpcFailure } from '../client';
import { policyRefusal } from './policy';
import type { FakeContext, FakeMethods } from './context';

export function mcpMethods(ctx: FakeContext): Pick<FakeMethods, `mcp.${string}` & keyof FakeMethods> {
  let servers: McpServer[] = [];
  const updated = (next: McpServer[]): void => {
    servers = next;
    ctx.emit('mcp.changed', {});
  };
  const invalid = (field: string, expected: string) => new RpcFailure({
    code: RpcErrorCode.InvalidParams, message: `${field} must be ${expected}`, data: { field, expected },
  });
  function get(id: unknown): McpServer {
    const server = servers.find(item => item.id === id);
    if (!server) throw invalid('id', 'an installed MCP server id');
    return server;
  }
  return {
    'mcp.list': async () => structuredClone({ servers, presets: MCP_PRESETS }),
    'mcp.save': async input => {
      let server: McpServer;
      try { server = normalizeMcpServer(input, servers, id => ctx.projects.some(project => project.id === id && !project.archived && project.kind !== 'drafts')); }
      catch (error) {
        if (!(error instanceof McpInputError)) throw error;
        throw invalid(error.field, error.expected);
      }
      updated(input.id === undefined ? [...servers, server] : servers.map(old => old.id === server.id ? server : old));
      return structuredClone(server);
    },
    'mcp.toggle': async input => {
      if (typeof input?.enabled !== 'boolean') throw invalid('enabled', 'a boolean');
      const current = get(input?.id);
      if (current.enabled === input.enabled) return structuredClone(current);
      const server = { ...current, enabled: input.enabled };
      updated(servers.map(old => old.id === server.id ? server : old));
      return structuredClone(server);
    },
    'mcp.remove': async input => {
      const server = get(input?.id);
      updated(servers.filter(old => old.id !== server.id));
      return { removed: true as const };
    },
    'mcp.test': async input => {
      if (ctx.policy.values.mcp === false) throw policyRefusal(ctx, 'mcp');
      const server = get(input?.id);
      const tools = server.id === 'filesystem'
        ? [{ name: 'list_directory', description: 'List the files and folders at a path.' }, { name: 'read_text_file', description: 'Read the contents of a text file.' }]
        : [{ name: 'example_tool', description: 'A sample tool from this server.' }];
      return { ok: true, latencyMs: 24, serverName: server.name, tools };
    },
  };
}
