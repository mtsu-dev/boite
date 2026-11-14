/**
 * ADEMark's Track B on Linux: what one prompt costs in tokens, side calls included.
 *
 *   ADEMARK_DIR=<ademark checkout> bun bench/ademark/tokens.ts --ade boite [--tests B1,B3] [--out <dir>]
 *   ADEMARK_DIR=<ademark checkout> bun bench/ademark/tokens.ts --ade bare-cli
 *
 * **This spends real tokens**: every request goes to the model API this shell
 * is signed in to (`ANTHROPIC_BASE_URL`, or Anthropic's), through the logging
 * proxy. B1 is `hi` three times, B3 one read-only prompt once, each on a new
 * thread in a fresh arena.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BareCli } from './bare.ts';
import { BoiteApp } from './boite.ts';
import { median, until } from './lib.ts';
import type { CaptureLine } from './proxy.ts';
import { freshArena, type Stage, startLiveStage } from './stage.ts';

const PROMPTS = {
  B1: { prompt: 'hi', runs: 3 },
  B3: { prompt: 'Read src/paginate.ts and src/dates.ts. Explain what each function does and list every bug you find with the line number. Do not change any file.', runs: 1 },
} as const;
/** ADEMark waits this long after the answer for the side calls an app sends late. */
const AFTER_MS = 30_000;

interface Call {
  model: string | null;
  /** A request that carries tools is the thread's own; anything else is a side call. */
  side: boolean;
  tokens: number;
  usage: NonNullable<CaptureLine['usage']>;
  bytes: number;
}

interface Run {
  total: number;
  side: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  requests: number;
  calls: Call[];
  /** How the main thread's last answer ends: ADEMark's repository rule asks for `ledger-ok`. */
  answerEnd: string;
}

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};
const ade = flag('ade', 'boite');
const tests = flag('tests', 'B1,B3').split(',').filter((test): test is keyof typeof PROMPTS => test in PROMPTS);
const out = flag('out', mkdtempSync(join(tmpdir(), 'boite-ademark-tokens-')));

function summed(lines: CaptureLine[]): Run {
  const calls: Call[] = [];
  for (const line of lines) {
    if (line.usage === null || !line.path.endsWith('/messages')) continue;
    const tools = (line.body as { tools?: unknown[] } | null)?.tools;
    const tokens = line.usage.input + line.usage.cacheWrite + line.usage.cacheRead + line.usage.output;
    calls.push({ model: line.model, side: !Array.isArray(tools) || tools.length === 0, tokens, usage: line.usage, bytes: line.bytes });
  }
  const sum = (pick: (call: Call) => number): number => calls.reduce((total, call) => total + pick(call), 0);
  const main = lines.filter((line) => Array.isArray((line.body as { tools?: unknown[] } | null)?.tools) && ((line.body as { tools: unknown[] }).tools.length > 0));
  return {
    total: sum((call) => call.tokens),
    side: sum((call) => (call.side ? call.tokens : 0)),
    input: sum((call) => call.usage.input),
    cacheWrite: sum((call) => call.usage.cacheWrite),
    cacheRead: sum((call) => call.usage.cacheRead),
    output: sum((call) => call.usage.output),
    requests: calls.length,
    calls,
    answerEnd: (main.at(-1)?.answer ?? '').trim().slice(-40),
  };
}

/** One prompt on a new thread: from the send to 30 s after the last answer ended. */
async function one(stage: Stage, dir: string, prompt: string): Promise<Run> {
  const arena = freshArena(join(dir, 'arena'));
  const before = stage.capture().length;
  const mainSeen = (): boolean => stage.capture().slice(before).some((line) => Array.isArray((line.body as { tools?: unknown[] } | null)?.tools) && line.usage !== null);
  const settled = async (): Promise<void> => {
    if (!(await until(() => mainSeen() && stage.quietMs() >= AFTER_MS, 900_000, 500))) throw new Error(`the requests of "${prompt}" never went quiet`);
  };
  if (ade === 'boite') {
    const app = new BoiteApp({ stage, out: dir, arena, live: true });
    try {
      await app.install();
      await app.thread(prompt, { title: 'New thread' });
      await settled();
    } finally {
      await app.quit();
    }
  } else {
    const cli = new BareCli({ stage, out: dir, arena, live: true });
    try {
      await cli.start(prompt);
      await settled();
    } finally {
      await cli.quit();
    }
  }
  return summed(stage.capture().slice(before));
}

mkdirSync(out, { recursive: true });
const stage = await startLiveStage(out);
const results: Record<string, unknown> = {};
try {
  for (const test of tests) {
    const runs: Run[] = [];
    for (let index = 0; index < PROMPTS[test].runs; index += 1) {
      const run = await one(stage, join(out, `${test}-${index + 1}`), PROMPTS[test].prompt);
      runs.push(run);
      console.log(`${test} run ${index + 1}: ${run.total} tokens in ${run.requests} requests (side calls ${run.side}; input ${run.input}, cache write ${run.cacheWrite}, cache read ${run.cacheRead}, output ${run.output}); answer ends "${run.answerEnd}"`);
      for (const call of run.calls) console.log(`  ${call.side ? 'side' : 'main'} ${call.model} ${call.tokens} tokens, ${call.bytes} B`);
    }
    results[`${test}/total`] = { value: median(runs.map((run) => run.total)), unit: 'tokens', runs: runs.map((run) => run.total) };
    results[`${test}/side`] = { value: median(runs.map((run) => run.side)), unit: 'tokens' };
    results[`${test}/requests`] = { value: median(runs.map((run) => run.requests)), unit: 'requests' };
    results[`${test}/detail`] = runs;
  }
} finally {
  await stage.stop();
  writeFileSync(join(out, 'tokens.json'), `${JSON.stringify({ ade, date: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`results: ${join(out, 'tokens.json')}`);
}
