/*
 * The download of a plugin's executable: over https only, at most 64 MB.
 * An idle timer rather than a deadline on the whole transfer: a slow link that
 * keeps sending finishes, a silent one stops with words saying so, and a
 * ceiling ends one that never does.
 */

const DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_CEILING_MS = 30 * 60_000;

export interface ArtifactFetch {
  /** The plugin's id, which every refusal names. */
  id: string;
  /** How long the transfer may receive nothing. */
  idleMs: number;
  /** Aborts the transfer: a cancel, a shutdown. */
  signal: AbortSignal;
  /** Bytes received so far, with the total the server announced or a guess. */
  progress(size: number, total: number): void;
}

/** The artifact's bytes, unverified: the caller checks them against the manifest's digest. */
export async function fetchArtifact(url: string, { id, idleMs, signal, progress }: ArtifactFetch): Promise<Buffer> {
  let size = 0;
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(new Error(`${id} download stalled: no data for ${Math.round(idleMs / 1000)} seconds after ${size} bytes.`)), idleMs);
  };
  const ceiling = setTimeout(() => idle.abort(new Error(`${id} download did not finish within ${DOWNLOAD_CEILING_MS / 60_000} minutes.`)), DOWNLOAD_CEILING_MS);
  const stop = AbortSignal.any([signal, idle.signal]);
  // A body already handed over does not always hear the abort: every wait races it.
  const stopped = new Promise<never>((_, reject) => stop.addEventListener('abort', () => reject(stop.reason), { once: true }));
  stopped.catch(() => undefined);
  try {
    arm();
    const response = await Promise.race([fetch(url, { signal: stop }), stopped]);
    if (response.url !== '' && !response.url.startsWith('https://')) {
      throw new Error(`${id} download was redirected to ${response.url}; artifacts come over https only.`);
    }
    if (!response.ok || !response.body) throw new Error(`${id} download returned HTTP ${response.status}.`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > DOWNLOAD_MAX_BYTES) throw new Error(`${id} download is ${declared} bytes, past the 64 MB a plugin may take.`);
    const total = declared || 3_000_000;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), stopped]);
        if (chunk.done) break;
        arm();
        size += chunk.value.length;
        if (size > DOWNLOAD_MAX_BYTES) throw new Error(`${id} download exceeds the 64 MB a plugin may take.`);
        chunks.push(chunk.value);
        progress(size, total);
      }
    } finally { void reader.cancel().catch(() => undefined); }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    clearTimeout(ceiling);
  }
}
