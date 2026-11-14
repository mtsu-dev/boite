/**
 * ADEMark's Track A on Linux, for Boite or for the Bare CLI.
 *
 *   ADEMARK_DIR=<ademark checkout> bun bench/ademark/run.ts --ade boite [--tests A1,A2,A3,A4,A5,A6,A7,A8,A10,A11] [--out <dir>]
 *   ADEMARK_DIR=<ademark checkout> bun bench/ademark/run.ts --ade bare-cli
 *
 * Every model request is answered by ADEMark's replay server, so no run spends
 * a token. `docs/internals/performance.md` says what each number is and how it
 * differs from the published macOS method.
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BareCli } from './bare.ts';
import { BoiteApp } from './boite.ts';
import { cpuPercent, median, now, percentile, PROBE, pss, type Sample, sampleFor, until } from './lib.ts';
import { freshArena, type Stage, startReplayStage } from './stage.ts';

interface Result {
  value: number;
  unit: string;
  runs?: number[];
  note?: string;
}

const MB = 1024 * 1024;
const SEED_MARKER = 'unchanged';
const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};
const ade = flag('ade', 'boite');
const tests = new Set(flag('tests', 'A1,A2,A3,A4,A5,A6,A7,A8,A10,A11').split(','));
const out = flag('out', mkdtempSync(join(tmpdir(), 'boite-ademark-')));
const reps = Number(flag('reps', '6'));
const results: Record<string, Result> = {};

function record(id: string, result: Result): void {
  results[id] = result;
  const runs = result.runs === undefined ? '' : ` (${result.runs.map((run) => run.toFixed(1)).join(', ')})`;
  console.log(`${id}: ${result.value.toFixed(2)} ${result.unit}${runs}${result.note === undefined ? '' : ` [${result.note}]`}`);
}

function timed(id: string, unit: 's' | 'ms', runs: number[], note?: string): void {
  const scaled = runs.map((run) => (unit === 's' ? run / 1000 : run));
  record(id, { value: median(scaled), unit, runs: scaled, ...(note === undefined ? {} : { note }) });
}

function weigh(samples: Sample[]): { app: number; agents: number; total: number } {
  return {
    app: median(samples.map((sample) => sample.appBytes)) / MB,
    agents: median(samples.map((sample) => sample.agentBytes)) / MB,
    total: median(samples.map((sample) => sample.appBytes + sample.agentBytes)) / MB,
  };
}

function load(samples: Sample[]): void {
  record('A7/app-p95', { value: percentile(samples.map((sample) => sample.appBytes), 0.95) / MB, unit: 'MB' });
  record('A7/agents-p95', { value: percentile(samples.map((sample) => sample.agentBytes), 0.95) / MB, unit: 'MB' });
  record('A7/total-p95', { value: percentile(samples.map((sample) => sample.appBytes + sample.agentBytes), 0.95) / MB, unit: 'MB', note: `${median(samples.map((sample) => sample.agentCount))} agents` });
}

async function typing(key: (character: string) => Promise<{ sent: number; shown: number | null }>): Promise<void> {
  const lags: number[] = [];
  let missed = 0;
  for (let index = 0; index < 60; index += 1) {
    const { sent, shown } = await key(PROBE[index % PROBE.length] as string);
    if (shown === null) missed += 1;
    else lags.push(shown - sent);
    await Bun.sleep(Math.max(0, 250 * (0.8 + Math.random() * 0.4) - (now() - sent)));
  }
  record('A8/p50', { value: median(lags), unit: 'ms' });
  record('A8/p95', { value: percentile(lags, 0.95), unit: 'ms', note: `${missed} missed, max ${Math.max(...lags).toFixed(1)} ms` });
}

async function boite(stage: Stage): Promise<void> {
  const app = new BoiteApp({ stage, out, arena: freshArena(join(out, 'arena')), live: false });
  try {
    await app.install();
    const seeds: string[] = [];
    for (let index = 0; index < 5; index += 1) seeds.push(await app.thread('replay:seed', { title: `seed ${index + 1}` }));
    await app.quit();

    if (tests.has('A1')) {
      const runs: number[] = [];
      let dropped = 0;
      for (let rep = 0; rep < reps; rep += 1) {
        dropped = app.purge();
        await Bun.sleep(3_000);
        const t0 = now();
        await app.launch();
        runs.push((await app.ready()) - t0);
        await app.clearComposer();
        await app.quit();
      }
      timed('A1/cold', 's', runs, `${dropped} files dropped from the page cache before each run`);
    }
    if (tests.has('A2')) {
      const runs: number[] = [];
      for (let rep = 0; rep < reps; rep += 1) {
        await Bun.sleep(1_000);
        const t0 = now();
        await app.launch();
        runs.push((await app.ready()) - t0);
        await app.clearComposer();
        await app.quit();
      }
      timed('A2/relaunch', 's', runs);
    }

    let rest: ReturnType<typeof weigh> | null = null;
    if (tests.has('A5') || tests.has('A6') || tests.has('A10')) {
      await app.launch();
      await app.ready();
      await app.clearComposer();
      await Bun.sleep(30_000);
      const samples = await sampleFor(60, () => app.groups());
      rest = weigh(samples);
      record('A5/app', { value: rest.app, unit: 'MB', note: `core alone ${(pss(app.corePid() ?? 0) / MB).toFixed(1)} MB` });
      record('A5/total', { value: rest.total, unit: 'MB', note: `${median(samples.map((sample) => sample.agentCount))} agents alive` });
      record('A6/front', { value: cpuPercent(samples), unit: '% CPU' });
      await app.quit();
    }
    if (tests.has('A10') && rest !== null) {
      await app.launch();
      await app.ready();
      await app.clearComposer();
      for (let index = 0; index < 15; index += 1) await app.thread('replay:seed', { title: `seed ${index + 6}` });
      await app.quit();
      await app.launch();
      await app.ready();
      await app.clearComposer();
      await Bun.sleep(30_000);
      const twenty = weigh(await sampleFor(60, () => app.groups()));
      record('A10/rest-20', { value: twenty.app, unit: 'MB' });
      record('A10/mb-per-thread', { value: (twenty.app - rest.app) / 15, unit: 'MB' });
      await app.quit();
    }

    await app.launch();
    await app.ready();
    await app.clearComposer();
    // The newest seed: the sidebar folds a project's older threads behind "Show more".
    const seed = seeds.at(-1) as string;
    if (tests.has('A3')) {
      const runs: number[] = [];
      for (let rep = 0; rep < reps; rep += 1) {
        await app.open(seed);
        if (!(await until(() => app.shows(SEED_MARKER), 10_000))) throw new Error('the seeded thread never showed its answer');
        await Bun.sleep(500);
        const t0 = now();
        await app.newThread();
        runs.push((await app.ready(30_000, SEED_MARKER)) - t0);
        await app.clearComposer();
      }
      timed('A3/default-mode', 'ms', runs);
    }
    if (tests.has('A4')) {
      // ADEMark types the prompt key by key 1.5 s after the new thread, and its paste variant waits 0.5 s before
      // Enter; `gapMs` 0 is the same send with Enter right behind the last key.
      const firstWord = async (id: string, gapMs: number, count: number): Promise<void> => {
        const total: number[] = [];
        const before: number[] = [];
        for (let rep = 0; rep < count; rep += 1) {
          await app.newThread();
          await Bun.sleep(1_500);
          await app.fill('replay:hi');
          await Bun.sleep(gapMs);
          const seen = app.watch('LEDGERMARK');
          const t0 = now();
          await app.enter();
          const shown = await seen;
          if (shown === null) throw new Error('LEDGERMARK never showed');
          total.push(shown - t0);
          // The capture gets a request's line when its answer ends.
          await Bun.sleep(2_000);
          const request = stage.capture().find((line) => line.at >= t0 && ((line.body as { tools?: unknown[] } | null)?.tools?.length ?? 0) > 0);
          if (request !== undefined) before.push(request.at - t0);
        }
        timed(`${id}/total`, 'ms', total);
        timed(`${id}/before-request`, 'ms', before);
      };
      await firstWord('A4', 500, reps);
      await firstWord('A4-no-gap', 0, Math.min(reps, 3));
    }

    if (tests.has('A7') || tests.has('A8')) {
      const streams = async (): Promise<string[]> => {
        const ids: string[] = [];
        for (let index = 1; index <= 5; index += 1) {
          ids.push(await app.thread(`replay:stream-${index}`, { wait: false }));
          if (index < 5) await Bun.sleep(2_000);
        }
        return ids;
      };
      let ids = await streams();
      await app.open(ids[0] as string);
      if (tests.has('A7')) {
        load(await sampleFor(165, () => app.groups()));
        await until(() => ids.every((id) => app.finished(id)), 120_000, 500);
      } else {
        await Bun.sleep(5_000);
      }
      if (tests.has('A8')) {
        if (tests.has('A7')) {
          ids = await streams();
          await app.open(ids[0] as string);
          await Bun.sleep(5_000);
        }
        await app.page.click('[data-testid="composer-input"]');
        await app.page.evaluate(`document.querySelector('[data-testid="composer-input"]').focus()`);
        await typing((character) => app.timedKey(character));
        if (ids.some((id) => app.finished(id))) throw new Error('a stream ended before the 60 keystrokes: A8 is invalid');
        await app.clearComposer();
      }
      for (const id of ids) await app.client.call('turns.stop', { threadId: id }).catch(() => undefined);
      await Bun.sleep(2_000);
    }

    if (tests.has('A11')) {
      const long = await app.thread('replay:long-2000', { title: 'long' });
      const runs: number[] = [];
      for (let rep = 0; rep < 5; rep += 1) {
        await app.open(seed);
        if (!(await until(() => app.shows(SEED_MARKER), 10_000))) throw new Error('the seeded thread never showed its answer');
        await Bun.sleep(1_500);
        const seen = app.watch('LONGTHREAD-END', 30_000, true);
        const t0 = now();
        await app.open(long);
        const shown = await seen;
        if (shown === null) {
          await app.page.screenshot(join(out, 'long-thread-failed.png'));
          throw new Error(`LONGTHREAD-END never showed: see ${join(out, 'long-thread-failed.png')}`);
        }
        runs.push(shown - t0);
      }
      timed('A11/open', 'ms', runs);
      await app.page.screenshot(join(out, 'long-thread.png'));
    }
  } finally {
    await app.quit();
  }
}

async function bare(stage: Stage): Promise<void> {
  const arena = freshArena(join(out, 'arena'));
  const system = Bun.which('claude');
  if (system === null) throw new Error('no `claude` on PATH');
  // Other sessions on this machine map the installed executable, which keeps it in memory: a copy can be made cold.
  const binary = join(out, 'claude');
  copyFileSync(system, binary);
  Bun.spawnSync(['chmod', '+x', binary]);
  const cli = new BareCli({ stage, out, arena, live: false, binary });
  try {
    if (tests.has('A1')) {
      const runs: number[] = [];
      let dropped = 0;
      for (let rep = 0; rep < reps; rep += 1) {
        dropped = cli.purge();
        await Bun.sleep(3_000);
        const t0 = now();
        await cli.launch();
        runs.push((await cli.ready()) - t0);
        await cli.quit();
      }
      timed('A1/cold', 's', runs, `${dropped} files dropped from the page cache before each run; no terminal app`);
    }
    if (tests.has('A2')) {
      const runs: number[] = [];
      for (let rep = 0; rep < reps; rep += 1) {
        await Bun.sleep(1_000);
        const t0 = now();
        await cli.launch();
        runs.push((await cli.ready()) - t0);
        await cli.quit();
      }
      timed('A2/relaunch', 's', runs);
    }
    if (tests.has('A3') || tests.has('A4')) {
      await cli.thread('replay:seed', SEED_MARKER);
      const opened: number[] = [];
      const total: number[] = [];
      const before: number[] = [];
      let lost = 0;
      for (let rep = 0; rep < reps; rep += 1) {
        await Bun.sleep(500);
        const t0 = now();
        await cli.newThread();
        opened.push((await cli.ready()) - t0);
        await cli.clearComposer();
        await cli.fill('replay:hi');
        const seen = cli.watch('LEDGERMARK');
        const sent = now();
        await cli.enter();
        const shown = await seen;
        // A prompt the CLI did not take (a probe character still in its input) is a lost repetition, not a time.
        if (shown === null) {
          lost += 1;
          continue;
        }
        total.push(shown - sent);
        await Bun.sleep(2_000);
        const request = stage.capture().find((line) => line.at >= sent && ((line.body as { tools?: unknown[] } | null)?.tools?.length ?? 0) > 0);
        if (request !== undefined) before.push(request.at - sent);
      }
      timed('A3/default-mode', 'ms', opened, 'a new Claude Code process');
      timed('A4/total', 'ms', total, lost === 0 ? undefined : `${lost} of ${reps} repetitions lost`);
      timed('A4/before-request', 'ms', before);
      await cli.quit();
    }
    let rest: ReturnType<typeof weigh> | null = null;
    if (tests.has('A5') || tests.has('A6') || tests.has('A7') || tests.has('A8') || tests.has('A10')) {
      for (let index = 0; index < 5; index += 1) await cli.thread('replay:seed', SEED_MARKER);
      await Bun.sleep(30_000);
      const samples = await sampleFor(60, () => cli.groups());
      rest = weigh(samples);
      record('A5/total', { value: rest.total, unit: 'MB', note: '5 Claude Code processes, no terminal app' });
      record('A6/front', { value: cpuPercent(samples, 'agents'), unit: '% CPU', note: 'the 5 idle Claude Code processes' });
    }
    if (tests.has('A10') && rest !== null) {
      for (let index = 0; index < 15; index += 1) await cli.thread('replay:seed', SEED_MARKER);
      await Bun.sleep(30_000);
      const twenty = weigh(await sampleFor(60, () => cli.groups()));
      record('A10/rest-20', { value: twenty.total, unit: 'MB' });
      record('A10/mb-per-thread', { value: (twenty.total - rest.total) / 15, unit: 'MB', note: 'a whole Claude Code process per thread; ADEMark counts the terminal tab only' });
      await cli.quit();
      for (let index = 0; index < 5; index += 1) await cli.thread('replay:seed', SEED_MARKER);
    }
    if (tests.has('A7') || tests.has('A8')) {
      const streams = async (): Promise<number> => {
        const first = cli.count();
        for (let index = 1; index <= 5; index += 1) {
          await cli.start(`replay:stream-${index}`);
          if (index < 5) await Bun.sleep(1_500);
        }
        return first;
      };
      let first = await streams();
      if (tests.has('A7')) {
        load(await sampleFor(165, () => cli.groups()));
        await Bun.sleep(25_000);
      }
      if (tests.has('A8')) {
        if (tests.has('A7')) first = await streams();
        await Bun.sleep(5_000);
        await typing((character) => cli.timedKey(character, first));
      }
    }
  } finally {
    await cli.quit();
  }
}

mkdirSync(out, { recursive: true });
const stage = await startReplayStage(out);
const started = new Date();
try {
  if (ade === 'boite') await boite(stage);
  else if (ade === 'bare-cli') await bare(stage);
  else throw new Error(`--ade must be boite or bare-cli: ${ade}`);
} finally {
  await stage.stop();
  writeFileSync(join(out, 'results.json'), `${JSON.stringify({ ade, date: started.toISOString(), host: { platform: process.platform, arch: process.arch, cpus: navigator.hardwareConcurrency, bun: Bun.version }, results }, null, 2)}\n`);
  console.log(`results: ${join(out, 'results.json')}`);
}
