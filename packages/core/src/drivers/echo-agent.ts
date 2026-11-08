/*
 * The child of the echo driver's `[process]` (`echo-process.ts`): it reads one
 * JSON request per line and writes the text back as `{"d":...}` lines, then
 * `{"done":true}`. `{"text"}` comes back in 16-character pieces 5 ms apart,
 * the echo driver's own pace; `{"flood":N}` is N characters as fast as the
 * pipe takes them. It exits once its stdin ends.
 *
 * `bun echo-agent.ts` from the sources, `--echo-agent` of the core's bundle
 * and binary. It loads none of the core.
 */

import { createInterface } from 'node:readline';

const CHUNK_SIZE = 16;
const CHUNK_DELAY_MS = 5;
/** One `[flood]` delta: 64 lines of 64 characters. */
const FLOOD_LINES = 64;

function floodChunk(n: number): string {
  let text = '';
  for (let line = 0; line < FLOOD_LINES; line += 1) text += `flood ${String(n * FLOOD_LINES + line).padStart(10, '0')} ${'.'.repeat(46)}\n`;
  return text;
}

export async function runEchoAgent(): Promise<void> {
  const write = (frame: unknown): Promise<void> => new Promise<void>((resolve) => {
    if (process.stdout.write(`${JSON.stringify(frame)}\n`)) resolve();
    else process.stdout.once('drain', () => resolve());
  });
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    let request: { text?: unknown; flood?: unknown };
    try { request = JSON.parse(line) as typeof request; } catch { continue; }
    if (typeof request.text === 'string') {
      for (let at = 0; at < request.text.length; at += CHUNK_SIZE) {
        await write({ d: request.text.slice(at, at + CHUNK_SIZE) });
        await Bun.sleep(CHUNK_DELAY_MS);
      }
    } else if (typeof request.flood === 'number' && Number.isInteger(request.flood) && request.flood > 0) {
      let left = request.flood;
      for (let n = 0; left > 0; n += 1) {
        const chunk = floodChunk(n);
        const piece = left >= chunk.length ? chunk : chunk.slice(0, left);
        left -= piece.length;
        await write({ d: piece });
      }
    }
    await write({ done: true });
  }
  process.exit(0);
}

if (import.meta.main) void runEchoAgent();
