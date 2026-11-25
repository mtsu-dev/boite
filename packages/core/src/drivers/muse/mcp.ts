import type { McpRegistration } from '../../mcp/lazy.ts';

const AUTH = 'BOITE_MCP_AUTHORIZATION';

// Same transport and header fields as protectedMuse settings.json. The native
// 1.4.14 host accepts them through -c and expands the header from its environment.
export function museMcpConfig(mcp: McpRegistration | null): { args: string[]; env: Record<string, string> } {
  if (mcp === null) return { args: [], env: {} };
  const args = Object.entries(mcp.entries).flatMap(([name, entry]) => ['-c', `mcp_servers.${name}=${JSON.stringify({
    transport: 'streamable_http', url: entry.url, headers: { Authorization: '$' + '{' + AUTH + '}' },
  })}`]);
  return { args, env: { [AUTH]: mcp.authorization } };
}
