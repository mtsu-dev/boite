import type { Core } from '../core.ts';
import { refused } from '../errors.ts';

export function registerMcpMethods(core: Core): void {
  // Owner only: a definition can run a command and can send credentials on the core's machine.
  core.router.register('mcp.list', (_input, { connection }) => ({ ...core.mcp.list(), encrypted: connection.encrypted === true }));
  core.router.register('mcp.save', (input, { connection }) => {
    const sendsSecret = (map: unknown) => typeof map === 'object' && map !== null && Object.values(map).some(value => value !== null && value !== undefined);
    if (connection.encrypted !== true && (sendsSecret(input?.secretEnv) || sendsSecret(input?.secretHeaders))) {
      throw refused('mcp.save: credentials travel only over an encrypted link', { field: 'connection', expected: 'loopback, Tailscale or HTTPS' });
    }
    return core.mcp.save(input);
  });
  core.router.register('mcp.toggle', input => core.mcp.toggle(input?.id, input?.enabled));
  core.router.register('mcp.remove', input => core.mcp.remove(input?.id));
  core.router.register('mcp.test', (input, { signal }) => core.mcp.test(input?.id, signal));
}
