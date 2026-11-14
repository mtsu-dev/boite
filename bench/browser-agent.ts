/**
 * Browser-agent bench: what `boite browser` costs an agent on eight typical
 * web tasks against a local fixture site whose server checks the result.
 *
 *   bun bench/browser-agent.ts [--repeat 3] [--cli "<command>"] [--tasks a,b]
 *       replay (default): scripted real CLI calls on a fresh core with an echo
 *       thread; no model, no tokens. --cli picks the CLI, default the sources
 *       (`bun packages/core/src/main.ts cli`), so a compiled binary compares.
 *   bun bench/browser-agent.ts --live [--model claude-opus-5-5] [--effort medium]
 *       [--runs 1] [--tasks a,b] [--timeout 300]
 *       live: each task's goal in words, one turn on a real Claude thread. Spends tokens.
 *
 * Results: bench/results/<date>-browser-agent.{json,md} and -browser-agent-live.{json,md}.
 * docs/internals/performance.md#a-browser-agent-on-eight-tasks says what each number means.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, relative } from 'node:path';
import { today } from './lib/report.ts';
import { runLive } from './browser-agent/live.ts';
import { liveMarkdown, replayMarkdown, summarizeReplay, type Host, type LiveReport, type ReplayReport } from './browser-agent/report.ts';
import { replayTask, splitCommand, startReplayCore, stopReplayCore, type TaskRun } from './browser-agent/replay.ts';
import { startSite, TASK_IDS, type TaskId } from './browser-agent/site.ts';
import { TASKS } from './browser-agent/tasks.ts';

const ROOT = join(import.meta.dir, '..');
const RESULTS = join(import.meta.dir, 'results');
const DEFAULT_CLI = `bun ${join(ROOT, 'packages', 'core', 'src', 'main.ts')} cli`;

interface Options {
  live: boolean;
  repeat: number;
  cli: string;
  tasks: TaskId[];
  model: string;
  effort: string;
  runs: number;
  timeoutMs: number;
  out: string;
}

const USAGE = 'bun bench/browser-agent.ts [--repeat N] [--cli "<command>"] [--tasks id,id] [--out <dir>]\n'
  + 'bun bench/browser-agent.ts --live [--model id] [--effort level] [--runs N] [--tasks id,id] [--timeout <seconds>] [--out <dir>]\n'
  + `tasks: ${TASK_IDS.join(', ')}`;

function parse(argv: string[]): Options {
  const options: Options = { live: false, repeat: 3, cli: DEFAULT_CLI, tasks: [...TASK_IDS], model: 'claude-opus-5-5', effort: 'medium', runs: 1, timeoutMs: 300_000, out: RESULTS };
  const count = (flag: string, text: string | undefined): number => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${flag}: expected a whole number from 1, got ${text ?? 'nothing'}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    switch (flag) {
      case '--live': options.live = true; break;
      case '--repeat': options.repeat = count(flag, next()); break;
      case '--cli': options.cli = next(); break;
      case '--model': options.model = next(); break;
      case '--effort': options.effort = next(); break;
      case '--runs': options.runs = count(flag, next()); break;
      case '--timeout': options.timeoutMs = count(flag, next()) * 1000; break;
      case '--out': options.out = next(); break;
      case '--tasks': {
        const ids = next().split(',').map((id) => id.trim()).filter(Boolean);
        const unknown = ids.filter((id) => !(TASK_IDS as readonly string[]).includes(id));
        if (unknown.length > 0 || ids.length === 0) throw new Error(`--tasks: unknown ${unknown.join(', ') || 'empty list'}; expected some of ${TASK_IDS.join(', ')}`);
        options.tasks = ids as TaskId[];
        break;
      }
      case '--help': console.log(USAGE); process.exit(0); break;
      default: throw new Error(`unknown argument ${flag}\n${USAGE}`);
    }
  }
  return options;
}

function host(): Host {
  return { platform: process.platform, arch: process.arch, cpus: cpus().length, bun: Bun.version, loadAverage: loadavg()[0] ?? 0 };
}

function commit(): string {
  const git = Bun.spawnSync(['git', 'rev-parse', '--short=9', 'HEAD'], { cwd: ROOT });
  return git.exitCode === 0 ? git.stdout.toString().trim() : 'unknown';
}

function save(out: string, name: string, report: unknown, markdown: string): { json: string; md: string } {
  mkdirSync(out, { recursive: true });
  const json = join(out, `${name}.json`);
  const md = join(out, `${name}.md`);
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(md, markdown, 'utf8');
  return { json, md };
}

const command = `bun bench/browser-agent.ts ${process.argv.slice(2).join(' ')}`.trim();
const options = parse(process.argv.slice(2));
const tasks = TASKS.filter((task) => options.tasks.includes(task.id));
const site = startSite();
const startedHost = host();
const log = (line: string): void => void process.stdout.write(`${line}\n`);

try {
  if (options.live) {
    const results = await runLive(tasks, site, { model: options.model, effort: options.effort, runs: options.runs, timeoutMs: options.timeoutMs }, log);
    const report: LiveReport = { date: today(), mode: 'live', commit: commit(), model: options.model, effort: options.effort, runs: options.runs, timeoutMs: options.timeoutMs, host: startedHost, results };
    const markdown = liveMarkdown(report, command);
    const written = save(options.out, `${report.date}-browser-agent-live`, report, markdown);
    process.stdout.write(`\n${markdown}\nwrote ${relative(process.cwd(), written.md)} and ${relative(process.cwd(), written.json)}\n`);
  } else {
    const cli = splitCommand(options.cli);
    const runs: TaskRun[] = [];
    const warmupMs: number[] = [];
    for (let repeat = 1; repeat <= options.repeat; repeat++) {
      // A fresh core per repeat: no repeat inherits the last one's tabs or journal.
      const core = await startReplayCore(cli, site);
      warmupMs.push(core.warmupMs);
      try {
        for (const task of tasks) {
          const run = await replayTask(task, repeat, cli, core, site);
          runs.push(run);
          log(`[replay ${repeat}/${options.repeat}] ${task.id}: ${run.ok ? 'ok' : 'FAILED'}, ${run.calls.length} calls, ${run.calls.reduce((s, c) => s + c.bytes, 0)} bytes, ${Math.round(run.wallMs)} ms${run.ok ? '' : ` (${run.detail})`}`);
        }
      } finally {
        await stopReplayCore(core);
      }
    }
    const titles = new Map(tasks.map((task) => [task.id, task.title] as const));
    const report: ReplayReport = { date: today(), mode: 'replay', commit: commit(), cli: options.cli === DEFAULT_CLI ? 'bun packages/core/src/main.ts cli' : options.cli, repeat: options.repeat, host: startedHost, warmupMs, ...summarizeReplay(runs, titles), runs };
    const markdown = replayMarkdown(report, command);
    const written = save(options.out, `${report.date}-browser-agent`, report, markdown);
    process.stdout.write(`\n${markdown}\nwrote ${relative(process.cwd(), written.md)} and ${relative(process.cwd(), written.json)}\n`);
    if (report.totals.successes < report.totals.runs) process.exitCode = 1;
  }
} finally {
  site.stop();
}
