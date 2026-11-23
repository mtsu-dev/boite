import type { ClientContext } from '@agentclientprotocol/sdk/unstable';
import { agentModelsOf } from './models.ts';
import { discardSession } from './protocol.ts';

/** Read controls from a new conversation and retire it even when a targeted read fails. */
export async function probeControls<T>(
  agent: ClientContext, cwd: string, meta: { _meta?: Record<string, unknown> }, canDelete: boolean,
  read: (created: Awaited<ReturnType<typeof newConversation>>) => T | Promise<T>,
): Promise<T> {
  const created = await newConversation(agent, cwd, meta);
  try { return await read(created); }
  finally { await discardSession(agent, canDelete, created.sessionId); }
}

export function newConversation(agent: ClientContext, cwd: string, meta: { _meta?: Record<string, unknown> }) {
  return agent.request('session/new', { cwd, mcpServers: [], ...meta });
}

export function discoveredControls(created: Awaited<ReturnType<typeof newConversation>>) {
  return { options: created.configOptions ?? [], listed: agentModelsOf(created) };
}
