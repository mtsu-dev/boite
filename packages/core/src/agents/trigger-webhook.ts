import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;
const BODY_TIMEOUT_MS = 10_000;
const MAX_READERS = 16;
const MAX_TRIGGER_READERS = 2;
const MAX_SIGNATURE_READERS_PER_SOURCE = 4;

/** A signature is untrusted until its body is read. It uses a separate pool from authenticated tokens. */
export class WebhookReaders {
  readonly #active = new Map<string, number>();

  acquire(id: string, source: string, authenticated: boolean): (() => void) | null {
    const pool = authenticated ? 'tokens' : 'signatures';
    const limits: [string, number][] = [[pool, MAX_READERS], [pool + ':' + id, MAX_TRIGGER_READERS]];
    if (!authenticated) limits.push(['source:' + source, MAX_SIGNATURE_READERS_PER_SOURCE]);
    if (limits.some(([key, max]) => (this.#active.get(key) ?? 0) >= max)) return null;
    for (const [key] of limits) this.#active.set(key, (this.#active.get(key) ?? 0) + 1);
    return () => {
      for (const [key] of limits) {
        const count = this.#active.get(key)! - 1;
        if (count === 0) this.#active.delete(key);
        else this.#active.set(key, count);
      }
    };
  }
}

export function webhookTokenMatches(header: string | null, expected: string): boolean {
  if (header === null || header.length !== expected.length || !/^[a-f0-9]+$/.test(header)) return false;
  return timingSafeEqual(Buffer.from(header, 'hex'), Buffer.from(expected, 'hex'));
}

export function webhookSignature(header: string | null): Buffer | null {
  return header !== null && /^sha256=[a-f0-9]{64}$/i.test(header) ? Buffer.from(header.slice(7), 'hex') : null;
}

export function webhookSignatureMatches(signature: Buffer, secret: string, body: Uint8Array): boolean {
  const digest = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(signature, digest);
}

export async function webhookBody(request: Request, signal: AbortSignal): Promise<Uint8Array | Response> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const bound = AbortSignal.any([signal, AbortSignal.timeout(BODY_TIMEOUT_MS)]);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  bound.addEventListener('abort', cancel, { once: true });
  const buffer = new Uint8Array(MAX_BODY_BYTES);
  let size = 0;
  try {
    while (!bound.aborted) {
      const { value, done } = await reader.read();
      if (bound.aborted) break;
      if (done) return buffer.subarray(0, size);
      if (size + value.byteLength > MAX_BODY_BYTES) {
        cancel();
        return new Response(null, { status: 413 });
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
    return new Response(null, { status: signal.aborted ? 503 : 408 });
  } catch {
    return new Response(null, { status: 400 });
  } finally {
    bound.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
