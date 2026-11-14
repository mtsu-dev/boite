/**
 * Replay mode: each task as a fixed scripted run of real `boite browser`
 * calls, the way the CLI's help teaches an agent to work. Every action takes
 * its target as a ref read by label out of the previous snapshot's output and
 * is followed by `snapshot -i`. A ref that fails (the CLI refuses it, or the
 * label is not in the snapshot) gets one `snapshot -i --full` and one retry, and
 * both extra calls are counted.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CoreClient } from '../../packages/core/src/client.ts';
import { echoThread, startTestCore, type TestCore } from '../../packages/core/test/harness.ts';
import type { FixtureSite, TaskId } from './site.ts';
import type { Driver, Target, Task } from './tasks.ts';

/** One CLI call as the agent saw it. */
export interface Call {
  /** The browser subcommand: open, snapshot, snapshot-i, click, fill... */
  command: string;
  ms: number;
  /** stdout plus stderr, in bytes: what the agent reads. */
  bytes: number;
  exitCode: number;
  /** A call made only because a ref failed: the extra snapshot or the retried action. */
  retry: boolean;
}

export interface TaskRun {
  task: TaskId;
  repeat: number;
  ok: boolean;
  /** The server-side checker's account, or why the script stopped. */
  detail: string;
  calls: Call[];
  /** Refs that failed once and were retried. */
  refRetries: number;
  wallMs: number;
}

const CALL_TIMEOUT_MS = 60_000;
const REF_FAILURE = /\bref @?e\d+|take a new snapshot|stale/i;

/** Words of a command line: whitespace splits, single or double quotes group. */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) words.push(match[1] ?? match[2] ?? match[3] ?? '');
  if (words.length === 0) throw new Error('--cli is empty');
  return words;
}

/** The ref of the first line with this role and exactly this label, in a snapshot's text. */
export function refOf(snapshot: string, target: Target): string | null {
  for (const line of snapshot.split('\n')) {
    const match = /^\s*- (\S+)(?: ("(?:[^"\\]|\\.)*"))?.*?\[ref=(e\d+)\]/.exec(line);
    if (match === null || match[1] !== target.role || match[2] === undefined) continue;
    let name: string;
    try {
      name = JSON.parse(match[2]) as string;
    } catch {
      continue;
    }
    if (name === target.name) return match[3] ?? null;
  }
  return null;
}

class RefMissing extends Error {}

/** The scripted agent: real CLI processes, each timed and weighed. */
class CliAgent implements Driver {
  readonly calls: Call[] = [];
  refRetries = 0;
  private last = '';

  constructor(
    private readonly cli: string[],
    private readonly env: Record<string, string | undefined>,
    private readonly cwd: string,
    private readonly base: string,
  ) {}

  private async run(args: string[], retry: boolean): Promise<{ out: string; err: string; code: number }> {
    const started = performance.now();
    const child = Bun.spawn([...this.cli, 'browser', ...args], { cwd: this.cwd, env: this.env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const timer = setTimeout(() => child.kill(), CALL_TIMEOUT_MS);
    const [outBytes, errBytes, code] = await Promise.all([
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).arrayBuffer(),
      child.exited,
    ]);
    clearTimeout(timer);
    const ms = performance.now() - started;
    const command = args[0] === 'snapshot' && args.includes('-i') ? 'snapshot -i' : (args[0] ?? '');
    this.calls.push({ command, ms, bytes: outBytes.byteLength + errBytes.byteLength, exitCode: code, retry });
    const decoder = new TextDecoder();
    return { out: decoder.decode(outBytes), err: decoder.decode(errBytes), code };
  }

  /** A retry reads the whole tree: a diff leaves out the unchanged line the missing ref may be on. */
  private async snapshot(retry = false): Promise<void> {
    const words = retry ? ['snapshot', '-i', '--full'] : ['snapshot', '-i'];
    const { out, err, code } = await this.run(words, retry);
    if (code !== 0) throw new Error(`${words.join(' ')} exited ${code}: ${(err || out).trim().slice(0, 200)}`);
    this.last = out;
  }

  /** Resolves the target in the last snapshot, runs the action, and on a ref failure re-snapshots once and retries. */
  private async act(command: string, target: Target, ...text: string[]): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const retry = attempt === 1;
      try {
        const ref = refOf(this.last, target);
        if (ref === null) throw new RefMissing(`no ${target.role} "${target.name}" in the last snapshot`);
        const { out, err, code } = await this.run([command, `@${ref}`, ...text], retry);
        if (code !== 0) {
          const said = (err || out).trim();
          if (REF_FAILURE.test(said)) throw new RefMissing(said);
          throw new Error(`${command} @${ref} exited ${code}: ${said.slice(0, 200)}`);
        }
        await this.snapshot();
        return;
      } catch (error) {
        if (!(error instanceof RefMissing) || retry) throw error;
        this.refRetries += 1;
        await this.snapshot(true);
      }
    }
  }

  async open(path: string): Promise<void> {
    const { out, err, code } = await this.run(['open', `${this.base}${path}`], false);
    if (code !== 0) throw new Error(`open exited ${code}: ${(err || out).trim().slice(0, 200)}`);
    await this.snapshot();
  }
  click(target: Target): Promise<void> {
    return this.act('click', target);
  }
  fill(target: Target, text: string): Promise<void> {
    return this.act('fill', target, text);
  }
  check(target: Target): Promise<void> {
    return this.act('check', target);
  }
  select(target: Target, value: string): Promise<void> {
    return this.act('select', target, value);
  }
  async read(): Promise<string> {
    const { out, err, code } = await this.run(['snapshot', '--full'], false);
    if (code !== 0) throw new Error(`snapshot --full exited ${code}: ${(err || out).trim().slice(0, 200)}`);
    // The core now diffs against this read: the next ref lookup uses it too.
    this.last = out;
    return out;
  }
}

export interface ReplayCore {
  harness: TestCore;
  owner: CoreClient;
  threadId: string;
  env: Record<string, string | undefined>;
  cwd: string;
  /** The first `open`, which starts the browser; kept out of the task figures. */
  warmupMs: number;
}

/** A fresh core on a temporary data directory, one echo thread, and its browser started on the site's index. */
export async function startReplayCore(cli: string[], site: FixtureSite): Promise<ReplayCore> {
  const harness = await startTestCore();
  const owner = await harness.connect();
  const { threadId } = await echoThread(harness, owner, 'browser agent bench');
  const cwd = join(harness.dataDir, 'agent-cwd');
  mkdirSync(cwd, { recursive: true });
  // The agent's door, as every process a thread launches gets it.
  const env = { ...process.env, BOITE_CORE_URL: harness.url, BOITE_AGENT_TOKEN: harness.core.agents.tokenFor(threadId), BOITE_THREAD_ID: threadId };
  const started = performance.now();
  const warm = Bun.spawn([...cli, 'browser', 'open', `${site.url}/`], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(warm.stdout).text(), new Response(warm.stderr).text(), warm.exited]);
  if (code !== 0) {
    owner.close();
    await harness.stop();
    throw new Error(`the warm-up open exited ${code}: ${(err || out).trim().slice(0, 300)}`);
  }
  return { harness, owner, threadId, env, cwd, warmupMs: performance.now() - started };
}

export async function stopReplayCore(core: ReplayCore): Promise<void> {
  core.owner.close();
  await core.harness.stop();
}

export async function replayTask(task: Task, repeat: number, cli: string[], core: ReplayCore, site: FixtureSite): Promise<TaskRun> {
  site.reset(task.id);
  const agent = new CliAgent(cli, core.env, core.cwd, site.url);
  const started = performance.now();
  let detail = '';
  let ok = false;
  try {
    await task.script(agent);
    const checked = task.check(site.state);
    ok = checked.ok;
    detail = checked.detail;
  } catch (error) {
    detail = `script stopped: ${error instanceof Error ? error.message : String(error)}; ${task.check(site.state).detail}`;
  }
  return { task: task.id, repeat, ok, detail, calls: agent.calls, refRetries: agent.refRetries, wallMs: performance.now() - started };
}
