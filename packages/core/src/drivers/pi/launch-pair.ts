import { piListsPair } from './models.ts';
import { piLaunchChoices } from './start-model.ts';
import type { PiModel } from './protocol.ts';
import { dataOf, type PiPeer } from './rpc.ts';

type Options = { signal?: AbortSignal; readMs?: number; writeMs?: number };

/** pi does not list the catalog's pair, whatever it started on, so nothing can switch to it. */
export class LaunchPairMissing extends Error {}

/** The level a launch asked for, as pi's parser walks its arguments (an option's value is never one), or none. */
export function launchLevel(args: readonly string[]): string | null {
  return piLaunchChoices(args).thinking ?? null;
}

/**
 * pi matches `--model` without regard to case (pi 1.6.1's model resolver), so ids that differ only by it can start
 * pi on another pair than the catalog's, which image admission read. `set_model` takes the exact pair and moves the
 * thinking level to the model's own, so the level the launch asked for (`level`) goes back after it: pi bounds it to
 * the new model, where the one it started on was bounded to the other. `state` is the `get_state` answer pi gave once
 * started. Without one, the level is the one pi picks on a switch (the model's own setting, else the account's
 * default, else the level it ran), as when its user switches models. A pair pi does not list is refused, never left
 * to pi's own pick.
 */
export async function alignLaunchedPair(peer: PiPeer, state: Record<string, unknown>, pair: { provider: string; modelId: string }, level: string | null, options: Options = {}): Promise<void> {
  const loaded = state['model'] as PiModel | null | undefined;
  const bound = (timeoutMs: number | undefined) => ({ ...(options.signal ? { signal: options.signal } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  const read = bound(options.readMs), write = bound(options.writeMs);
  // Listed first, even when pi reports the pair: for an id its provider no longer lists, pi makes a custom model of
  // that id with another model's capabilities, which image admission never read.
  if (!piListsPair(dataOf(await peer.command('get_available_models', {}, read))['models'], pair)) {
    const named = `${pair.provider}/${pair.modelId}`;
    const same = loaded?.provider === pair.provider && loaded?.id === pair.modelId;
    const started = same ? '' : `started on ${loaded ? `${loaded.provider}/${loaded.id}` : 'no model'} and `;
    throw new LaunchPairMissing(`pi ${started}does not list ${named}: its models changed or its provider is no longer signed in; refresh the models list`);
  }
  if (loaded?.provider === pair.provider && loaded?.id === pair.modelId) return;
  await peer.command('set_model', pair, write);
  if (level !== null) await peer.command('set_thinking_level', { level }, write);
}
