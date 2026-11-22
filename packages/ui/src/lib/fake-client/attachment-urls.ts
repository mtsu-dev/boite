import { decodeBase64 } from '../attachment-save';

const MAX_ENTRIES = 32;
const MAX_BYTES = 24 * 1024 * 1024;
type Ticket = { data: ''; url: string; mimeType: string; bytes: number };

/** Original bytes behind the fake core's tickets, released on eviction or close. */
export class FakeAttachmentUrls {
  readonly #held = new Map<string, Ticket>();
  #bytes = 0;

  read(key: string, part: { data: string; mimeType: string }): Ticket {
    const held = this.#held.get(key);
    if (held) {
      this.#held.delete(key);
      this.#held.set(key, held);
      return held;
    }
    const blob = new Blob([decodeBase64(part.data)], { type: part.mimeType });
    const ticket: Ticket = { data: '', url: URL.createObjectURL(blob), mimeType: part.mimeType, bytes: blob.size };
    this.#held.set(key, ticket);
    this.#bytes += ticket.bytes;
    while (this.#held.size > MAX_ENTRIES || (this.#held.size > 1 && this.#bytes > MAX_BYTES)) {
      const [oldest, evicted] = this.#held.entries().next().value!;
      URL.revokeObjectURL(evicted.url);
      this.#held.delete(oldest);
      this.#bytes -= evicted.bytes;
    }
    return ticket;
  }

  clear(): void {
    for (const ticket of this.#held.values()) URL.revokeObjectURL(ticket.url);
    this.#held.clear();
    this.#bytes = 0;
  }
}
