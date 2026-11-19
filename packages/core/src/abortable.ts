/** Stops waiting at a cancellation boundary. The work receives the same signal when it supports cancellation. */
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const stopped = Promise.withResolvers<never>();
  const abort = () => stopped.reject(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  try {
    const result = await Promise.race([stopped.promise, work]);
    signal.throwIfAborted();
    return result;
  } finally { signal.removeEventListener('abort', abort); }
}
