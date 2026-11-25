import type { Core } from '../core.ts';
import { probeMcp } from './probe.ts';

export function registerMcpMethods(core: Core): void {
  // Owner only: a definition can run a command and can send credentials on the core's machine.
  core.router.register('mcp.list', () => core.mcp.list());
  core.router.register('mcp.save', input => core.mcp.save(input));
  core.router.register('mcp.toggle', input => core.mcp.toggle(input?.id, input?.enabled));
  core.router.register('mcp.remove', input => core.mcp.remove(input?.id));
  core.router.register('mcp.test', input => probeMcp(core, core.mcp.get(input?.id)));
}
