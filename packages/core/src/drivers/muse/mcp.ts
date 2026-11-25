import type { McpRegistration } from '../../mcp/lazy.ts';

const AUTH = 'BOITE_MCP_AUTHORIZATION';

export function museMcpConfig(mcp: McpRegistration | null): { args: string[]; env: Record<string, string> } {
  if (mcp === null) return { args: [], env: {} };
  const args = Object.entries(mcp.entries).flatMap(([name, entry]) => ['-c', `mcp_servers.${name}=${JSON.stringify({
    transport: 'streamable_http', url: entry.url, headers: { Authorization: '$' + '{' + AUTH + '}' },
  })}`]);
  return { args, env: { [AUTH]: mcp.authorization } };
}
