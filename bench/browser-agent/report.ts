/** Summaries and markdown tables for the two modes of the browser-agent bench. */
import { median, percentile } from '../lib/report.ts';
import type { TaskId } from './site.ts';
import type { TaskRun } from './replay.ts';

export interface Host {
  platform: string;
  arch: string;
  cpus: number;
  bun: string;
  /** 1-minute load average when the run started: the machine is shared, and a loaded one stretches every call. */
  loadAverage: number;
}

export interface ReplayTaskSummary {
  task: TaskId;
  title: string;
  runs: number;
  successes: number;
  /** Medians across repeats of each run's totals. */
  calls: number;
  refRetries: number;
  bytes: number;
  /** bytes / 4: an estimate of the tokens the agent would read, not a tokenizer count. */
  estimatedTokens: number;
  /** Over every call of every repeat. */
  callMsMedian: number;
  callMsP95: number;
  taskMsMedian: number;
}

export interface CommandSummary {
  command: string;
  calls: number;
  msMedian: number;
  msP95: number;
  bytesMedian: number;
}

export interface ReplayReport {
  date: string;
  mode: 'replay';
  commit: string;
  cli: string;
  repeat: number;
  host: Host;
  warmupMs: number[];
  tasks: ReplayTaskSummary[];
  commands: CommandSummary[];
  totals: { successes: number; runs: number; calls: number; bytes: number; estimatedTokens: number; callMsMedian: number; callMsP95: number };
  runs: TaskRun[];
}

const round = (value: number): number => Math.round(value);

export function summarizeReplay(runs: TaskRun[], titles: Map<TaskId, string>): Pick<ReplayReport, 'tasks' | 'commands' | 'totals'> {
  const tasks: ReplayTaskSummary[] = [];
  for (const [task, title] of titles) {
    const mine = runs.filter((run) => run.task === task);
    if (mine.length === 0) continue;
    const ms = mine.flatMap((run) => run.calls.map((call) => call.ms));
    const bytes = median(mine.map((run) => run.calls.reduce((sum, call) => sum + call.bytes, 0)));
    tasks.push({
      task,
      title,
      runs: mine.length,
      successes: mine.filter((run) => run.ok).length,
      calls: median(mine.map((run) => run.calls.length)),
      refRetries: median(mine.map((run) => run.refRetries)),
      bytes: round(bytes),
      estimatedTokens: round(bytes / 4),
      callMsMedian: round(median(ms)),
      callMsP95: round(percentile(ms, 0.95)),
      taskMsMedian: round(median(mine.map((run) => run.wallMs))),
    });
  }
  const byCommand = new Map<string, { ms: number[]; bytes: number[] }>();
  for (const call of runs.flatMap((run) => run.calls)) {
    const entry = byCommand.get(call.command) ?? { ms: [], bytes: [] };
    entry.ms.push(call.ms);
    entry.bytes.push(call.bytes);
    byCommand.set(call.command, entry);
  }
  const commands = [...byCommand].map(([command, entry]) => ({
    command,
    calls: entry.ms.length,
    msMedian: round(median(entry.ms)),
    msP95: round(percentile(entry.ms, 0.95)),
    bytesMedian: round(median(entry.bytes)),
  }));
  const all = runs.flatMap((run) => run.calls.map((call) => call.ms));
  const repeats = new Set(runs.map((run) => run.repeat)).size || 1;
  const sumOver = (pick: (run: TaskRun) => number): number => runs.reduce((sum, run) => sum + pick(run), 0) / repeats;
  const bytes = sumOver((run) => run.calls.reduce((sum, call) => sum + call.bytes, 0));
  return {
    tasks,
    commands,
    totals: {
      successes: runs.filter((run) => run.ok).length,
      runs: runs.length,
      calls: round(sumOver((run) => run.calls.length)),
      bytes: round(bytes),
      estimatedTokens: round(bytes / 4),
      callMsMedian: round(median(all)),
      callMsP95: round(percentile(all, 0.95)),
    },
  };
}

const hostLine = (host: Host): string =>
  `${host.platform} ${host.arch}, ${host.cpus} logical cores, Bun ${host.bun}, load average ${host.loadAverage.toFixed(1)} at the start.`;

export function replayMarkdown(report: ReplayReport, command: string): string {
  const lines = [
    `# Browser agent bench, replay, ${report.date}`,
    '',
    `Commit \`${report.commit}\`. CLI \`${report.cli}\`. ${report.repeat} repeats. ${hostLine(report.host)}`,
    '',
    `Command: \`${command}\``,
    '',
    'Each task is a fixed script of real `boite browser` calls against a fresh core with an echo thread: `open`,',
    'then for each action the action on a ref read by label from the previous output, followed by `snapshot -i`.',
    'Calls, bytes and tokens are medians over the repeats of one run of the task; call times pool every call of',
    'every repeat. Tokens are bytes / 4, an estimate, not a tokenizer count.',
    '',
    '| task | success | calls | ref retries | bytes read | est. tokens | call median | call p95 | task wall |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const t of report.tasks) {
    lines.push(`| ${t.task}: ${t.title} | ${t.successes}/${t.runs} | ${t.calls} | ${t.refRetries} | ${t.bytes} | ~${t.estimatedTokens} | ${t.callMsMedian} ms | ${t.callMsP95} ms | ${t.taskMsMedian} ms |`);
  }
  const s = report.totals;
  lines.push(`| all 8, per repeat | ${s.successes}/${s.runs} | ${s.calls} | | ${s.bytes} | ~${s.estimatedTokens} | ${s.callMsMedian} ms | ${s.callMsP95} ms | |`);
  lines.push('', '## Per command', '', '| command | calls | median | p95 | median bytes |', '| --- | --- | --- | --- | --- |');
  for (const c of report.commands) lines.push(`| ${c.command} | ${c.calls} | ${c.msMedian} ms | ${c.msP95} ms | ${c.bytesMedian} |`);
  lines.push('', `The first \`open\` of each core, which starts the browser, is not counted: ${report.warmupMs.map((ms) => `${round(ms)} ms`).join(', ')}.`);
  const failed = report.runs.filter((run) => !run.ok);
  if (failed.length > 0) {
    lines.push('', '## Failed runs', '');
    for (const run of failed) lines.push(`- ${run.task}, repeat ${run.repeat}: ${run.detail}`);
  }
  lines.push('');
  return lines.join('\n');
}

export interface LiveRun {
  task: TaskId;
  run: number;
  ok: boolean;
  detail: string;
  /** Tool calls the agent made, from the thread's messages. */
  toolCalls: number;
  /** `boite browser` invocations inside those calls: one shell call can chain several. */
  browserCommands: number;
  /** As the core recorded them on the turn (`Turn.usage`), null when the turn carried none. */
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  costUsdEquivalent: number | null;
  wallMs: number;
  status: string;
  error: string | null;
  /** The model and effort the turn ran with, from its execution record. */
  ranWith: string;
}

export interface LiveReport {
  date: string;
  mode: 'live';
  commit: string;
  model: string;
  effort: string;
  runs: number;
  timeoutMs: number;
  host: Host;
  results: LiveRun[];
}

const value = (n: number | null): string => (n === null ? 'n/a' : String(n));

export function liveMarkdown(report: LiveReport, command: string): string {
  const lines = [
    `# Browser agent bench, live, ${report.date}`,
    '',
    `Commit \`${report.commit}\`. Model \`${report.model}\`, effort \`${report.effort}\`, ${report.runs} run(s) per task, ${round(report.timeoutMs / 1000)} s timeout. ${hostLine(report.host)}`,
    '',
    `Command: \`${command}\``,
    '',
    'Each task is its goal in words, sent as one turn to a fresh Claude thread on a fresh core, with the',
    'Boite guide on. Success is the fixture server\'s own check. Tokens are the turn\'s usage as the core',
    'stored it: input excludes cache reads and writes.',
    '',
    '| task | run | success | tool calls | browser commands | input | cache read | cache write | output | wall | ran with | status |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of report.results) {
    lines.push(`| ${r.task} | ${r.run} | ${r.ok ? 'yes' : 'no'} | ${r.toolCalls} | ${r.browserCommands} | ${value(r.inputTokens)} | ${value(r.cacheReadTokens)} | ${value(r.cacheWriteTokens)} | ${value(r.outputTokens)} | ${round(r.wallMs / 1000)} s | ${r.ranWith} | ${r.status}${r.error ? `: ${r.error.replace(/\|/g, '/').slice(0, 120)}` : ''} |`);
  }
  lines.push('', '## Checker', '');
  for (const r of report.results) lines.push(`- ${r.task}, run ${r.run}: ${r.detail}`);
  lines.push('');
  return lines.join('\n');
}
