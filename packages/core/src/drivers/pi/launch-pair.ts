import { piListsPair } from './models.ts';
import type { PiModel } from './protocol.ts';
import { dataOf, type PiPeer } from './rpc.ts';

type Options = { signal?: AbortSignal; readMs?: number; writeMs?: number };

/** pi started on another pair than the catalog's and does not list the catalog's, so nothing can switch to it. */
export class LaunchPairMissing extends Error {}

/** The level a launch asked for: the last `--thinking` among its arguments, as pi reads them, or none. */
export function launchLevel(args: readonly string[]): string | null {
  const at = args.lastIndexOf('--thinking');
  return at < 0 ? null : args[at + 1] ?? null;
}

/**
 * pi matches `--model` without regard to case (pi 1.6.1's model resolver), so ids that differ only by it can start
 * pi on another pair than the catalog's, which image admission read. `set_model` takes the exact pair and moves the
 * thinking level to the model's own, so the level the launch asked for (`level`) goes back after it: pi bounds it to
 * the new model, where the one it started on was bounded to the other. `state` is the `get_state` answer pi gave once
 * started. A pair pi does not list is refused, never left to pi's own pick.
 */
export async function alignLaunchedPair(peer: PiPeer, state: Record<string, unknown>, pair: { provider: string; modelId: string }, level: string | null, options: Options = {}): Promise<void> {
  const loaded = state['model'] as PiModel | null | undefined;
  if (loaded?.provider === pair.provider && loaded?.id === pair.modelId) return;
  const bound = (timeoutMs: number | undefined) => ({ ...(options.signal ? { signal: options.signal } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  const read = bound(options.readMs), write = bound(options.writeMs);
  if (!piListsPair(dataOf(await peer.command('get_available_models', {}, read))['models'], pair)) {
    const running = loaded ? `${loaded.provider}/${loaded.id}` : 'no model';
    throw new LaunchPairMissing(`pi started on ${running} and does not list ${pair.provider}/${pair.modelId}: refresh the models list`);
  }
  await peer.command('set_model', pair, write);
  if (level !== null) await peer.command('set_thinking_level', { level }, write);
}
