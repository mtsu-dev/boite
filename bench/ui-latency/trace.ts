import { join } from 'node:path';
import type { BrowserPage } from '../../tests/e2e/lib/cdp.ts';

/** A second CDP connection drains Chrome's trace stream without loading the
 * full trace into the benchmark process or receiving E2E network events. */
export async function profiled<T>(page: BrowserPage, dir: string | undefined, name: string, measure: () => Promise<T>): Promise<T> {
  if (!dir) return measure();
  const url = page.target.webSocketDebuggerUrl;
  if (!url) throw new Error('Chrome did not expose a CDP socket for tracing');
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome for tracing')), { once: true });
  });
  let id = 0;
  const pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
  const complete = Promise.withResolvers<string>();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.method === 'Tracing.tracingComplete') complete.resolve(message.params.stream);
    pending.get(message.id)?.(message);
  });
  function send<T>(method: string, params = {}): Promise<T> {
    const next = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(next);
        reject(new Error(method + ' timed out'));
      }, 30_000);
      pending.set(next, message => {
        clearTimeout(timer);
        pending.delete(next);
        if (message.error) reject(new Error(method + ': ' + message.error.message));
        else resolve(message.result as T);
      });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  }
  const path = join(dir, name.replaceAll('/', '-'));
  async function exportTrace(): Promise<void> {
    const { profile } = await page.send('Profiler.stop', {}) as { profile: unknown };
    await Bun.write(path + '.cpuprofile', JSON.stringify(profile));
    await send('Tracing.end');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stream = await Promise.race([complete.promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Chrome did not finish tracing')), 30_000);
    })]).finally(() => clearTimeout(timer));
    if (!stream) throw new Error('Chrome finished tracing without a stream');
    const file = Bun.file(path + '.trace.json').writer();
    try {
      for (;;) {
        const chunk = await send<{ data: string; base64Encoded?: boolean; eof: boolean }>('IO.read', { handle: stream, size: 262_144 });
        file.write(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
        if (chunk.eof) break;
      }
    } finally {
      await file.end();
      await send('IO.close', { handle: stream });
    }
  }
  try {
    await send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      traceConfig: { includedCategories: [
        'devtools.timeline', 'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-devtools.timeline', 'blink.user_timing', 'cc',
      ] },
    });
    await page.send('Profiler.enable', {});
    await page.send('Profiler.start', {});
    try {
      return await measure();
    } finally {
      await exportTrace();
    }
  } finally {
    socket.close();
  }
}
