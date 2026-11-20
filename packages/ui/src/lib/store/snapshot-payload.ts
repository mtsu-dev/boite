import { projectMessage, type Thread, type TransportOptions } from '@boite/contracts';
import { SNAPSHOT_BYTES } from '../thread-snapshots';
import { resumeRequest } from '../thread-rows';

const encoder = new TextEncoder();
const BATCH = 16;

/** Build the existing JSON format in bounded slices. Undefined means the page moved while it was being read. */
export async function snapshotPayload(thread: Thread, transport: TransportOptions | undefined, pause: () => Promise<boolean>): Promise<Uint8Array<ArrayBuffer> | null | undefined> {
  if (thread.incognito) return null;
  const { messages, turns, ...metadata } = thread;
  const payload = new Uint8Array(SNAPSHOT_BYTES);
  let length = 0;
  function append(text: string): boolean {
    const { read, written } = encoder.encodeInto(text, payload.subarray(length));
    length += written;
    return read === text.length;
  }

  if (!append(`{"thread":${JSON.stringify(metadata).slice(0, -1)},"messages":[`)) return null;
  for (let index = 0; index < messages.length; index++) {
    if (index && index % BATCH === 0 && !await pause()) return undefined;
    const message = messages[index]!;
    if (message.parts.some(part => part.type === 'secret_request')) return null;
    const light = transport ? projectMessage(message, transport) : message;
    if (!append((index ? ',' : '') + JSON.stringify(light))) return null;
  }
  if (!append('],"turns":[')) return null;
  for (let index = 0; index < turns.length; index++) {
    if (index % BATCH === 0 && !await pause()) return undefined;
    if (!append((index ? ',' : '') + JSON.stringify(turns[index]))) return null;
  }
  const after = resumeRequest(thread.id, thread).after ?? null;
  return append(`]},"after":${JSON.stringify(after)}}`) ? payload.subarray(0, length) : null;
}
