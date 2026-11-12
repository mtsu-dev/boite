/** Bun string/scan cost only; no DOM, layout, native shell or provider. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ParagraphScan, answerText } from '../packages/ui/src/lib/message-display.ts';

const root = resolve(import.meta.dir, '..'), dir = mkdtempSync(join(tmpdir(), 'boite-render-bench-'));
const base = '071246768ba8d490e91f91aba381dd39fb888731';
const original = execFileSync('git', ['show', `${base}:packages/ui/src/lib/message-display.ts`], { cwd: root, encoding: 'utf8' });
writeFileSync(join(dir, 'before.ts'), original
  .replace("'./markdown'", JSON.stringify(join(root, 'packages/ui/src/lib/markdown.ts')))
  .replace("'./fences'", JSON.stringify(join(root, 'packages/ui/src/lib/fences.ts'))));
let sink = 0;
try {
  const old = await import(join(dir, 'before.ts')) as {
    ParagraphScan: typeof ParagraphScan;
    pendingDrawing(text: string): { text: string; drawing: boolean };
  };
  console.log(JSON.stringify({ date: new Date().toISOString(), bun: Bun.version, platform: process.platform, base }));
  for (const mode of ['before', 'after-fallback', 'after-known-append']) {
    const times: number[] = [];
    for (let run = 0; run < 8; run++) {
      const scan = mode === 'before' ? new old.ParagraphScan() : new ParagraphScan();
      const epoch = mode === 'after-known-append' ? {} : undefined;
      let text = '```ts\n' + ('const entry = 42; // a representative source line\n'.repeat(Math.ceil(1048576 / 48))).slice(0, 1048576);
      scan.blocks(text, true, epoch);
      const start = performance.now();
      for (let delta = 0; delta < 200; delta++) {
        text += 'additional source line // increment\n';
        const shown = answerText(text, true);
        scan.blocks(shown, true, epoch);
        sink += (mode === 'before' ? old.pendingDrawing(scan.pending(shown)) : scan.drafting(shown)).text.length;
      }
      if (run) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ mode, initialChars: 1048582, deltas: 200, medianMs: times[Math.floor(times.length / 2)], samples: times.length }));
  }
  console.log('sink', sink);
} finally { rmSync(dir, { recursive: true, force: true }); }
