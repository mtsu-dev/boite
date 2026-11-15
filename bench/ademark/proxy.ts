/**
 * A logging proxy in front of a model API: ADEMark reads every request an app
 * sends from a network capture (TESTS.md 1.5); mitmproxy needs a trusted CA,
 * this needs only `ANTHROPIC_BASE_URL`. Each request is forwarded untouched
 * (`--replay-keys` aside, see `withReplayKey`) and
 * leaves one JSON line: when it arrived, its path, its body, the usage the
 * answer reported and when the first byte came back. Headers are never written,
 * so no token reaches the file.
 *
 *   bun bench/ademark/proxy.ts --port 8790 --upstream http://127.0.0.1:8787 --log capture.jsonl
 */
import { appendFileSync, writeFileSync } from 'node:fs';

export interface CaptureLine {
  /** Milliseconds on `performance.timeOrigin + performance.now()`, the clock a page reads too. */
  at: number;
  path: string;
  status: number;
  /** Milliseconds from the request's arrival to the first byte of the answer. */
  firstByteMs: number | null;
  model: string | null;
  /** The parsed request, or null when the body is not JSON. */
  body: unknown;
  bytes: number;
  usage: { input: number; cacheWrite: number; cacheRead: number; output: number } | null;
  /** The answer's text and tool names, cut short: enough to tell a title call from a turn. */
  answer: string;
}

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/** Reads `usage` out of an SSE stream or a JSON message; later events overwrite earlier ones field by field. */
export class UsageReader {
  #usage: Usage = {};
  #seen = false;
  #pending = '';
  answer = '';

  feed(text: string): void {
    this.#pending += text;
    let end = this.#pending.indexOf('\n');
    while (end !== -1) {
      this.#line(this.#pending.slice(0, end));
      this.#pending = this.#pending.slice(end + 1);
      end = this.#pending.indexOf('\n');
    }
  }

  finish(): CaptureLine['usage'] {
    if (this.#pending.trim() !== '') this.#line(this.#pending);
    if (!this.#seen) return null;
    return {
      input: this.#usage.input_tokens ?? 0,
      cacheWrite: this.#usage.cache_creation_input_tokens ?? 0,
      cacheRead: this.#usage.cache_read_input_tokens ?? 0,
      output: this.#usage.output_tokens ?? 0,
    };
  }

  #line(line: string): void {
    const json = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!json.startsWith('{')) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(json) as Record<string, unknown>;
    } catch {
      return;
    }
    const message = event.message as Record<string, unknown> | undefined;
    for (const usage of [event.usage, message?.usage]) {
      if (usage === null || typeof usage !== 'object') continue;
      this.#seen = true;
      for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
        if (typeof value === 'number') (this.#usage as Record<string, number>)[key] = value;
      }
    }
    const delta = event.delta as Record<string, unknown> | undefined;
    if (typeof delta?.text === 'string' && this.answer.length < 400) this.answer += delta.text;
    const block = event.content_block as Record<string, unknown> | undefined;
    if (block?.type === 'tool_use' && this.answer.length < 400) this.answer += `[tool ${String(block.name)}]`;
    if (Array.isArray(event.content)) {
      for (const part of event.content as Record<string, unknown>[]) {
        if (typeof part.text === 'string' && this.answer.length < 400) this.answer += part.text;
      }
    }
  }
}

export interface Proxy {
  url: string;
  /** Milliseconds since the last answer ended, 0 while one is still on its way. */
  quietMs(): number;
  stop(): Promise<void>;
}

const REPLAY_KEY = /^(replay:[a-z0-9-]+(?: @\d+s)?)$/m;

/**
 * The replay server finds its session by a user text block that is exactly the
 * key (`replay:hi`). An app that sends the prompt inside a longer block of its
 * own gets no session, so the key is added as one more block of that message.
 * Only a request with tools is touched: a title call that quotes the prompt is
 * a side call and must not start a three minute stream.
 */
export function withReplayKey(body: unknown): unknown {
  const request = body as { tools?: unknown[]; messages?: { role?: string; content?: unknown }[] } | null;
  if (request === null || typeof request !== 'object' || !Array.isArray(request.tools) || request.tools.length === 0 || !Array.isArray(request.messages)) return body;
  for (const message of request.messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    const texts = (message.content as { type?: string; text?: unknown }[]).filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text as string);
    for (const text of texts) {
      const key = REPLAY_KEY.exec(text)?.[1];
      if (key === undefined) continue;
      if (!texts.some((other) => other.trim() === key)) (message.content as unknown[]).push({ type: 'text', text: key });
      return body;
    }
  }
  return body;
}

export function startProxy(options: { port: number; upstream: string; log: string; replayKeys?: boolean }): Proxy {
  writeFileSync(options.log, '');
  const upstream = options.upstream.replace(/\/$/, '');
  let open = 0;
  let lastEnd = performance.now();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port,
    idleTimeout: 255,
    async fetch(request) {
      const at = performance.timeOrigin + performance.now();
      const started = performance.now();
      open += 1;
      const url = new URL(request.url);
      const raw = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
      let body: unknown = null;
      if (raw !== null) {
        try {
          body = JSON.parse(new TextDecoder().decode(raw));
        } catch {
          body = null;
        }
      }
      let forwarded: BodyInit | null = raw;
      if (options.replayKeys === true && body !== null && url.pathname.endsWith('/messages')) forwarded = JSON.stringify(withReplayKey(structuredClone(body)));
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('content-length');
      // The answer is read here for its usage, so it must arrive uncompressed.
      headers.delete('accept-encoding');
      const answer = await fetch(`${upstream}${url.pathname}${url.search}`, { method: request.method, headers, body: forwarded, redirect: 'manual' }).catch((error: unknown) => {
        open -= 1;
        lastEnd = performance.now();
        throw error;
      });
      const reader = new UsageReader();
      const decoder = new TextDecoder();
      let firstByteMs: number | null = null;
      let recorded = false;
      const record = (): void => {
        if (recorded) return;
        recorded = true;
        open -= 1;
        lastEnd = performance.now();
        const line: CaptureLine = {
          at,
          path: url.pathname,
          status: answer.status,
          firstByteMs,
          model: typeof (body as { model?: unknown } | null)?.model === 'string' ? (body as { model: string }).model : null,
          body,
          bytes: raw?.byteLength ?? 0,
          usage: reader.finish(),
          answer: reader.answer,
        };
        appendFileSync(options.log, `${JSON.stringify(line)}\n`);
      };
      const responseHeaders = new Headers(answer.headers);
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('content-length');
      if (answer.body === null) {
        record();
        return new Response(null, { status: answer.status, headers: responseHeaders });
      }
      const source = answer.body.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await source.read();
            if (chunk.done) {
              record();
              controller.close();
              return;
            }
            firstByteMs ??= performance.now() - started;
            reader.feed(decoder.decode(chunk.value, { stream: true }));
            controller.enqueue(chunk.value);
          } catch (error) {
            // An upstream that breaks mid-answer still ends the request: it is logged, and the client sees the error.
            record();
            throw error;
          }
        },
        async cancel() {
          await source.cancel().catch(() => undefined);
          record();
        },
      });
      return new Response(stream, { status: answer.status, headers: responseHeaders });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    quietMs: () => (open > 0 ? 0 : performance.now() - lastEnd),
    async stop(): Promise<void> {
      await server.stop(true);
    },
  };
}

if (import.meta.main) {
  const flag = (name: string, fallback: string): string => {
    const at = process.argv.indexOf(`--${name}`);
    return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
  };
  const upstream = flag('upstream', '');
  if (upstream === '') throw new Error('--upstream needs the address of the model API or of the replay server');
  const proxy = startProxy({ port: Number(flag('port', '8790')), upstream, log: flag('log', 'capture.jsonl'), replayKeys: process.argv.includes('--replay-keys') });
  console.log(`ademark proxy listening on ${proxy.url}, forwarding to ${upstream}`);
}
