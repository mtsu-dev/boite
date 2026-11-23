import type { ClientContext, LoadSessionResponse } from '@agentclientprotocol/sdk/unstable';
import type { SpawnedChild } from '../../procs.ts';
import { errorCodeOf } from '../driver-log.ts';
import type { SessionContext } from '../types.ts';
import { loadRefusal, LoadRefused, rpcReason, rpcRefusal } from './load.ts';
import { isHermes } from './protocol.ts';

export async function loadConversation(
  ctx: SessionContext, sessionId: string, agent: ClientContext, child: SpawnedChild,
  meta: { _meta?: Record<string, unknown> }, refusedLoads: Set<string>, ended: () => boolean,
): Promise<LoadSessionResponse> {
  // Every `session/update` of a load is history replay: `current` is null,
  // so the update handler drops them, all but a running cost.
  const refusedKey = `${ctx.provider.id}\0${sessionId}`;
  let loaded: LoadSessionResponse;
  try {
    loaded = await agent.request('session/load', {
      sessionId,
      cwd: ctx.thread.cwd,
      mcpServers: [],
      ...meta,
    });
  } catch (error) {
    // Only an answer from a live agent says anything about the session; a
    // dead pipe is the process's failure.
    if (!rpcRefusal(error) || ended() || child.exitCode !== null) throw error;
    const reason = rpcReason(error);
    ctx.log('warn', `acp: ${ctx.provider.id} refused to load the session ${sessionId}: ${reason}`);
    const kind = loadRefusal(error, reason);
    ctx.diagnostic?.('warn', `session/load refused with code ${errorCodeOf((error as { code?: unknown }).code) ?? 'unknown'}, read as ${kind}`, { event: 'driver.session.load-refused', data: { code: errorCodeOf((error as { code?: unknown }).code), kind } });
    if (kind === 'gone' || (kind === 'unsure' && refusedLoads.has(refusedKey))) {
      // Pruned, migrated, another project: retrying the same id would fail
      // every turn of the thread from now on.
      refusedLoads.delete(refusedKey);
      throw new LoadRefused(
        `${ctx.provider.name} no longer has this conversation (${reason}). Send the message again: Boite starts a new session that carries the conversation so far.`,
        true,
      );
    }
    if (kind === 'unsure') refusedLoads.add(refusedKey);
    // Signed out, or a failure on the agent's side: the session may well
    // still be there, and the next turn loads it again.
    throw new LoadRefused(
      `${ctx.provider.name} could not open this conversation (${reason}). The session is kept: send the message again to retry.`,
      false,
    );
  }
  if (isHermes(ctx.provider) && (loaded === null || loaded.modes === undefined || loaded.modes === null)) {
    // Hermes answers an id it does not have with an empty result instead
    // of an error, and a prompt on it then stops as a refusal. Each session
    // it does have comes back with its modes, so their absence is the "no".
    refusedLoads.delete(refusedKey);
    ctx.log('warn', `acp: ${ctx.provider.id} answered session/load ${sessionId} with no session`);
    ctx.diagnostic?.('warn', 'session/load answered with no session, read as gone', { event: 'driver.session.load-refused', data: { code: null, kind: 'gone' } });
    throw new LoadRefused(
      `${ctx.provider.name} no longer has this conversation (it answered the load with no session). Send the message again: Boite starts a new session that carries the conversation so far.`,
      true,
    );
  }
  refusedLoads.delete(refusedKey);
  return loaded;
}
