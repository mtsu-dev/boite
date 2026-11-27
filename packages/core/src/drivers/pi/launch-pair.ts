import { piListsPair } from './models.ts';
import type { PiModel } from './protocol.ts';
import { dataOf, type PiPeer } from './rpc.ts';

type Options = { signal?: AbortSignal; readMs?: number; writeMs?: number };

/**
 * pi matches `--model` without regard to case (pi 1.6.1's model resolver), so ids that differ only by it can start
 * pi on another pair than the catalog's, which image admission read. `set_model` takes the exact pair. It moves the
 * thinking level to the model's own, so the level pi started on (the thread's effort or the profile's `--thinking`)
 * goes back after it. `state` is the `get_state` answer pi gave once started. False when pi does not list the pair,
 * which leaves pi on its own pick.
 */
export async function alignLaunchedPair(peer: PiPeer, state: Record<string, unknown>, pair: { provider: string; modelId: string }, options: Options = {}): Promise<boolean> {
  const loaded = state['model'] as PiModel | null | undefined;
  if (loaded?.provider === pair.provider && loaded?.id === pair.modelId) return true;
  const bound = (timeoutMs: number | undefined) => ({ ...(options.signal ? { signal: options.signal } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  const read = bound(options.readMs), write = bound(options.writeMs);
  if (!piListsPair(dataOf(await peer.command('get_available_models', {}, read))['models'], pair)) return false;
  const level = state['thinkingLevel'];
  await peer.command('set_model', pair, write);
  if (typeof level === 'string') await peer.command('set_thinking_level', { level }, write);
  return true;
}
