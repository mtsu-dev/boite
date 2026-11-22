/**
 * Real client latency on the in-memory transport in muted headless Chrome.
 * Run: bun bench/ui-latency.ts [--browser <chrome>] [--runs 3]
 *         [--only typing,switch,tabs,mochi,settings,panels,stream,heap] [--trace <dir>]
 * Build once with --build <dir>, then use --bundle <dir> across runs.
 * --only also accepts a case's full name (see the JSON results).
 */
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildUiFixture } from './lib/ui-fixture.ts';

const { values } = parseArgs({ options: {
  build: { type: 'string' },
  bundle: { type: 'string' },
  browser: { type: 'string' },
  runs: { type: 'string', default: '3' },
  only: { type: 'string' },
  trace: { type: 'string' },
} });

if (values.build) {
  const ui = resolve(import.meta.dir, '../packages/ui');
  const source = ui.replaceAll('\\', '/') + '/src/lib/';
  const fixture = join(import.meta.dir, 'ui-latency/fixture.ts').replaceAll('\\', '/');
  await buildUiFixture(ui, resolve(values.build), id => {
    if (id === source + 'fake-client.ts') {
      return [
        { find: 'seed(ctx);', replace: 'seed(ctx); seedLatency(ctx, longThread, count => seedIdle(ctx, count));' },
        { append: `\nimport { seedLatency } from ${JSON.stringify(fixture)};\nimport { longThread } from './fake-client/threads-seed.ts';\n` },
      ];
    }
    if (id === source + 'fake-client/threads.ts') {
      // Use one full snapshot to prepare a previously read transcript. Every
      // timed open, resume and page request uses the standard fake limits.
      return [
        { find: 'const maxBytes = pageBytes(params.maxBytes);\n      const asked = params.limit ?? MESSAGE_PAGE;',
          replace: 'const preload = globalThis.__latencyPreload === thread.id;\n      const maxBytes = pageBytes(preload ? undefined : params.maxBytes);\n      const asked = params.limit ?? MESSAGE_PAGE;' },
        { find: 'const limit = Math.min(Math.max(1, Math.trunc(asked)), MESSAGE_PAGE_MAX);',
          replace: 'const limit = preload ? thread.messages.length : Math.min(Math.max(1, Math.trunc(asked)), MESSAGE_PAGE_MAX);' },
        { find: 'const from = params.after === undefined ? -1 : thread.messages.findIndex',
          replace: 'const from = preload || params.after === undefined ? -1 : thread.messages.findIndex' },
        { find: 'aroundOf(thread.messages, params.around, limit, project, maxBytes)',
          replace: 'aroundOf(thread.messages, preload ? undefined : params.around, limit, project, maxBytes)' },
        { find: 'const sent = new Set(page.messages.map(message => message.turnId));',
          replace: 'if (preload) globalThis.__latencyPreloadCount = page.messages.length;\n      const sent = new Set(page.messages.map(message => message.turnId));' },
      ];
    }
  });
} else {
  const runs = Number(values.runs);
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  const { runLatency } = await import('./ui-latency/run.ts');
  await runLatency({ ...values, runs });
}
