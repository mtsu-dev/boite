import type { FileHandle } from 'node:fs/promises';
import type { HeldBytes } from '../workdir.ts';
import type { SharedFilePermit } from '../contacts/access-policy.ts';

/** RFC 8187 attr-char excludes these four characters that encodeURIComponent leaves literal. */
export function attachmentDisposition(name = 'download'): string {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}

/**
 * Bytes a ticket of `FileTickets.mintBytes` names: an attachment of a message,
 * its original or a picture copy. The bytes behind that ticket never change, so the
 * client keeps them for good and the timeline draws them again without
 * asking; a new ticket is a new address. Players use ranges to seek. An
 * incognito conversation's are kept by no cache, since it leaves nothing
 * behind once erased.
 */
export function heldBytes(held: HeldBytes, range: string | null): Response {
  // Bytes from SQLite or a Buffer, both backed by an ArrayBuffer.
  return fileResponse(held.data as Uint8Array<ArrayBuffer>, range, {
    'content-type': held.mime,
    'cache-control': held.noStore ? 'no-store' : 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': attachmentDisposition(held.name),
  });
}

function byteRange(range: string | null, size: number) {
  const asked = range === null ? null : /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!asked) return null;
  const from = asked[1] ?? '', to = asked[2] ?? '';
  const start = from ? Number(from) : Math.max(0, size - Number(to));
  const end = !from ? size - 1 : to ? Math.min(Number(to), size - 1) : size - 1;
  if ((!from && !to) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'unsatisfiable' as const;
  const length = end - start + 1;
  return { start, length, headers: { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(length) } };
}

function rangeNotSatisfiable(size: number, headers: Record<string, string>): Response {
  return new Response('range not satisfiable', { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
}

/** A single byte range, shared by downloadable snapshots and isolated preview assets. */
export function fileResponse(file: Blob | Uint8Array<ArrayBuffer>, range: string | null, headers: Record<string, string>, head = false): Response {
  const size = file instanceof Uint8Array ? file.byteLength : file.size;
  headers = { ...headers, 'accept-ranges': 'bytes' };
  if (head) return new Response(null, { headers: { ...headers, 'content-length': String(size) } });
  const asked = byteRange(range, size);
  if (!asked) return new Response(file, { headers });
  if (asked === 'unsatisfiable') return rangeNotSatisfiable(size, headers);
  const end = asked.start + asked.length;
  const body = file instanceof Uint8Array ? file.subarray(asked.start, end) : file.slice(asked.start, end);
  return new Response(body, { status: 206, headers: { ...headers, ...asked.headers } });
}

/** The same range rules as `fileResponse`, read from a handle opened once. The handle closes with the body. */
export function fdResponse(handle: FileHandle, size: number, range: string | null, headers: Record<string, string>, permit?: SharedFilePermit): Response {
  headers = { ...headers, 'accept-ranges': 'bytes' };
  const asked = byteRange(range, size);
  if (asked === 'unsatisfiable') {
    void handle.close();
    return rangeNotSatisfiable(size, headers);
  }
  const status = asked ? 206 : 200;
  const length = asked?.length ?? size;
  headers = { ...headers, 'content-length': String(size), ...asked?.headers };
  if (length === 0) {
    void handle.close();
    return new Response(null, { status, headers });
  }
  let offset = asked?.start ?? 0;
  let remaining = length;
  let tail = '';
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    void handle.close();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        permit?.check();
        if (remaining <= 0) {
          close();
          controller.close();
          return;
        }
        const chunk = Math.min(remaining, 64 * 1024);
        const buffer = Buffer.alloc(chunk);
        const { bytesRead } = await handle.read(buffer, 0, chunk, offset);
        if (bytesRead <= 0) throw new Error(`file response: unexpected end of file with ${remaining} bytes remaining`);
        if (permit) {
          const text = buffer.subarray(0, bytesRead).toString('utf8');
          permit.inspect(tail + text); tail = text.slice(-512);
        }
        offset += bytesRead;
        remaining -= bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
        if (remaining <= 0) {
          close();
          controller.close();
        }
      } catch (error) {
        close();
        controller.error(error);
      }
    },
    cancel() { close(); },
  });
  return new Response(body, { status, headers });
}
