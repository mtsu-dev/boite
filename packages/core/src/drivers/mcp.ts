import type { McpRegistration, StdioServer } from '../mcp/lazy.ts';
import type { SessionContext } from './types.ts';

export function sessionMcp(
  ctx: SessionContext, env: Record<string, string | undefined> = {}, legacy = new Map<string, StdioServer>(),
): McpRegistration | null {
  if (ctx.protectedExecution || ctx.thread.contextMode?.mcp === false) return null;
  return ctx.lazyMcp?.(env, legacy) ?? null;
}
