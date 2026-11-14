import { messageOf, unavailable } from '../errors.ts';
import { withLogDiagnostic } from '../log-errors.ts';
import type { ProbeContext } from './types.ts';

interface ModelProbe {
  /** What the child is in a refusal: "agent" or "host". */
  noun: string;
  timeoutMs: number;
  /** How much of the last stderr line a refusal quotes. */
  stderrMax: number;
  /** Fails the requests still waiting, once the probe is over. */
  over: () => void;
}

/**
 * A short-lived child asked for its models: `read` races the child's exit and
 * a deadline, a refusal quotes the last line the child printed, and the child
 * goes through the registry that traced it on every path.
 */
export async function probeModels<T, R = T>(
  ctx: ProbeContext,
  child: ReturnType<ProbeContext['spawnChild']>,
  probe: ModelProbe,
  read: () => Promise<T>,
  /** Runs on the answer that won, before the child is released. */
  accepted: (answer: T) => R = (answer) => answer as unknown as R,
): Promise<R> {
  let lastStderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const text = line.trim();
      if (text.length > 0) lastStderr = text.slice(0, probe.stderrMax);
    }
  });

  const detail = { providerId: ctx.provider.id, accountId: ctx.accountId };
  const say = (head: string) => withLogDiagnostic(unavailable(lastStderr.length === 0 ? head : `${head}: ${lastStderr}`, detail), head);
  const who = `the ${ctx.provider.id} ${probe.noun}`;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const died = new Promise<never>((_resolve, reject) => {
      child.once('exit', (code) => {
        reject(say(`${who} exited with code ${code ?? 'unknown'}`));
      });
      child.once('error', (error) => {
        reject(say(`${who} did not start: ${messageOf(error)}`));
      });
    });
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(say(`${who} did not list its models in ${probe.timeoutMs / 1000} s`));
      }, probe.timeoutMs);
      timer.unref?.();
    });
    return accepted(await Promise.race([read(), died, expired]));
  } finally {
    if (timer !== null) clearTimeout(timer);
    probe.over();
    try {
      child.stdin.end();
    } catch {
      // the pipe is already gone
    }
    ctx.killTree();
  }
}
