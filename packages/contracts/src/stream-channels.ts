import type { MessagePart, RpcEventName, RpcEvents, ThreadId } from './index';

/**
 * What a socket subscribed to a thread receives of its streaming messages.
 * `text` is the text and thinking parts and their deltas; `tools` is the tool
 * cards, their streamed input and their status; `liveOutput` is what a running
 * call printed so far, which a driver redraws as often as once a second. A
 * subscription that names no channels receives all of them. Every other event
 * of the thread (a message starting or ending, permissions, questions) is sent
 * whatever the channels.
 */
export const STREAM_CHANNELS = ['text', 'tools', 'liveOutput'] as const;
export type StreamChannel = (typeof STREAM_CHANNELS)[number];

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

/** The field and the expected value when `channels` is not a list of known channels, else null. */
export function streamChannelsProblem(channels: unknown): { field: string; expected: string } | null {
  if (channels === undefined) return null;
  const expected = `an array of ${STREAM_CHANNELS.map(name => `'${name}'`).join(', ')}`;
  if (!Array.isArray(channels)) return { field: 'channels', expected };
  for (const [index, name] of channels.entries()) {
    if (!(STREAM_CHANNELS as readonly unknown[]).includes(name)) return { field: `channels[${index}]`, expected: `one of ${STREAM_CHANNELS.join(', ')}` };
  }
  return null;
}

/** The channel a part's live events travel on, null for a part no channel holds back (files, pictures, permissions). */
export function partChannel(part: Pick<MessagePart, 'type'>): 'text' | 'tools' | null {
  if (part.type === 'text' || part.type === 'thinking') return 'text';
  if (part.type === 'tool') return 'tools';
  return null;
}

/**
 * A running call as a socket without `liveOutput` receives it: what it printed
 * stays on the core, marked deferred, so its card reads it when it opens.
 */
export function withoutLiveOutput(part: ToolPart): ToolPart {
  if (part.status !== 'running' || part.output === null || part.output === '') return part;
  return { ...part, output: '', outputDeferred: true };
}

/** The most running calls one socket remembers the last withheld frame of; past it, a redraw may be sent twice. */
const WITHHELD_MAX = 1024;

/**
 * One socket's channels, by thread, and what it last received of each running
 * call it gets without output. The core's connection and the in-memory client
 * both narrow their live events through it.
 */
export class StreamGate {
  readonly #channels = new Map<ThreadId, ReadonlySet<StreamChannel>>();
  /** `thread|message|part` to the JSON of the last running call sent without its output. */
  readonly #withheld = new Map<string, string>();

  /** The channels this socket receives for `threadId`, null for all of them. */
  channels(threadId: ThreadId): ReadonlySet<StreamChannel> | null {
    return this.#channels.get(threadId) ?? null;
  }

  /**
   * Sets `threadId`'s channels, every channel when `channels` is undefined, and
   * returns the ones that were off and are now on: the caller sends what the
   * thread's streaming messages hold on them.
   */
  set(threadId: ThreadId, channels: readonly StreamChannel[] | undefined): StreamChannel[] {
    const before = this.#channels.get(threadId);
    const next = channels === undefined ? null : new Set(channels);
    if (next === null || next.size === STREAM_CHANNELS.length) this.#channels.delete(threadId);
    else this.#channels.set(threadId, next);
    this.#forgetWithheld(threadId);
    if (before === undefined) return [];
    return STREAM_CHANNELS.filter(name => !before.has(name) && (next === null || next.has(name)));
  }

  /** The thread is no longer subscribed: its channels and what was withheld go. */
  forget(threadId: ThreadId): void {
    this.#channels.delete(threadId);
    this.#forgetWithheld(threadId);
  }

  #forgetWithheld(threadId: ThreadId): void {
    if (this.#withheld.size === 0) return;
    const prefix = `${threadId}|`;
    for (const key of this.#withheld.keys()) if (key.startsWith(prefix)) this.#withheld.delete(key);
  }

  /**
   * The event as this socket receives it, or null when it receives none of it.
   * `kindOf` names the part a delta lands on, read only when `text` or `tools`
   * is off: a delta can be a text's words or a tool's streamed input.
   */
  filter<E extends RpcEventName>(name: E, payload: RpcEvents[E], kindOf?: (messageId: string, partIndex: number) => MessagePart['type'] | undefined): RpcEvents[E] | null {
    if (name !== 'message.part' && name !== 'message.delta') return payload;
    const event = payload as RpcEvents['message.part'] | RpcEvents['message.delta'];
    const channels = this.#channels.get(event.threadId);
    if (channels === undefined) return payload;
    if (name === 'message.delta') {
      const kind = kindOf?.(event.messageId, event.partIndex);
      const channel = kind === undefined ? 'text' : partChannel({ type: kind });
      return channel === null || channels.has(channel) ? payload : null;
    }
    const part = (event as RpcEvents['message.part']).part;
    const key = `${event.threadId}|${event.messageId}|${event.partIndex}`;
    // A finished call reaches every socket: it is the result, not the stream.
    if (part.type === 'tool' && part.status !== 'running') {
      this.#withheld.delete(key);
      return payload;
    }
    const channel = partChannel(part);
    if (channel === null) return payload;
    if (!channels.has(channel)) return null;
    if (part.type !== 'tool' || channels.has('liveOutput')) return payload;
    // A redraw that changed only the output: this socket already has the card as it shows.
    const shown = withoutLiveOutput(part);
    const text = JSON.stringify(shown);
    if (this.#withheld.get(key) === text) return null;
    if (this.#withheld.size >= WITHHELD_MAX) this.#withheld.clear();
    this.#withheld.set(key, text);
    return (shown === part ? payload : { ...event, part: shown }) as RpcEvents[E];
  }
}
