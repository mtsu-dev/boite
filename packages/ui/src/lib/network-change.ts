/**
 * One word for "the network may have changed", whoever heard it first: a core
 * whose addresses changed (`network.changed`), or a machine that came back by
 * itself after failing. `GroupLinks.start` listens and retries what was out of reach.
 */
const listeners = new Set<() => void>();

export function networkChanged(): void {
  for (const listener of [...listeners]) listener();
}

export function onNetworkChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
