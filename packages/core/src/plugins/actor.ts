/*
 * Who a plugin's change is recorded as: the plugin, by id and by its name as
 * it is now, so the record still reads after an uninstall (docs/internals/plugins.md,
 * Permissions). Every other caller records nothing here.
 */

import { pluginPermissionFor, type PluginActor, type RpcMethodName, type ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import type { RpcContext } from '../router.ts';
import type { Identity } from '../sessions.ts';
import { CREATED_BY_PREFIX, withLoad } from '../threads/records.ts';

export function pluginActor(core: Core, identity: Identity): PluginActor | undefined {
  if (identity.principal !== 'plugin' || identity.pluginId === undefined) return undefined;
  return { pluginId: identity.pluginId, pluginName: core.plugins.state(identity.pluginId).name };
}

/** A conversation a plugin created names it from then on; the row is sent again with the name. */
export function recordCreator(core: Core, thread: ThreadSummary, actor: PluginActor | undefined): ThreadSummary {
  if (actor === undefined) return thread;
  core.journal.setSetting(`${CREATED_BY_PREFIX}${thread.id}`, actor);
  const summary = withLoad(core, core.threads.require(thread.id));
  core.bus.emit('thread.updated', summary);
  return summary;
}

/**
 * Every change a plugin's token made goes in the core's log, named after the
 * plugin and the method: a permission whose methods only read logs nothing.
 */
export function logPluginChange(core: Core, method: RpcMethodName, params: unknown, ctx: RpcContext): void {
  const permission = pluginPermissionFor(method);
  if (permission === null || permission.endsWith('.read')) return;
  const actor = pluginActor(core, ctx.connection.identity);
  if (actor === undefined) return;
  const threadId = typeof params === 'object' && params !== null && typeof (params as { threadId?: unknown }).threadId === 'string' ? (params as { threadId: string }).threadId : undefined;
  core.logs.info(`${method} by plugin ${actor.pluginName}`, { source: 'plugins', event: 'plugin.change', ...(threadId ? { threadId } : {}), data: { ...actor, method, permission } });
}
