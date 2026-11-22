/**
 * A real agent's turn played again by a fake one. `bench/transfer/record.ts`
 * writes what the driver read from the agent during one turn: a header line,
 * then one JSON value per line. `codex-server.ts` replays a Codex recording
 * under `CODEX_FAKE_REPLAY=<file>`, `acp-agent.ts` an ACP one under
 * `ACP_FAKE_REPLAY=<file>`, and the scripted Claude query takes the SDK
 * messages of `claudeReplay`. Each writes the whole turn at once, so what the
 * core sends on is the same from one run to the next.
 */
import { readFileSync } from 'node:fs';

/** Every this many items, `REPLAY_PAUSE_MS` stops the replay. */
export const REPLAY_PAUSE_EVERY = 39;

/**
 * `REPLAY_PAUSE_MS=<ms>`: the fake waits that long before item 39, 78 and so
 * on, the way a slow agent or a busy machine spaces its output. The transfer
 * bench's test sets it to check that its numbers do not depend on the pace.
 */
export async function replayPause(index: number): Promise<void> {
  const ms = Number(process.env['REPLAY_PAUSE_MS'] ?? 0);
  if (ms > 0 && index > 0 && index % REPLAY_PAUSE_EVERY === 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

type Json = Record<string, unknown>;

function recorded(path: string): Json[] {
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '');
  return lines.slice(1).map((line) => JSON.parse(line) as Json);
}

const fail = (path: string, what: string): never => { throw new Error(`${path}: ${what}`); };

/**
 * A Codex turn: the thread id the fake hands out at `thread/start`, so the
 * recorded notifications need no rewrite, the answer to `turn/start`, and the
 * notifications in their order. A request the agent sent to the client is left
 * out: nobody would answer it twice.
 */
export function codexReplay(path: string): { threadId: string; turn: unknown; notifications: Json[] } {
  const lines = recorded(path);
  const started = lines.find((line) => line['method'] === 'turn/started')?.['params'] as Json | undefined;
  const answer = lines.find((line) => line['method'] === undefined && (line['result'] as Json | undefined)?.['turn'] !== undefined);
  return {
    threadId: typeof started?.['threadId'] === 'string' ? started['threadId'] : fail(path, 'no turn/started notification names the thread'),
    turn: (answer?.['result'] as Json | undefined)?.['turn'] ?? fail(path, 'no answer to turn/start'),
    notifications: lines.filter((line) => typeof line['method'] === 'string' && line['id'] === undefined),
  };
}

/** An ACP turn: the session the fake hands out at `session/new`, its updates in order and the answer to `session/prompt`. */
export function acpReplay(path: string): { sessionId: string; updates: unknown[]; result: unknown } {
  const lines = recorded(path);
  const updates = lines.filter((line) => line['method'] === 'session/update').map((line) => line['params'] as Json);
  return {
    sessionId: (updates[0]?.['sessionId'] as string | undefined) ?? fail(path, 'no session/update names the session'),
    updates: updates.map((params) => params['update']),
    result: lines.findLast((line) => line['method'] === undefined && 'result' in line)?.['result'] ?? fail(path, 'no answer to session/prompt'),
  };
}

/** A Claude turn: the SDK messages the query yielded, in order. */
export function claudeReplay(path: string): unknown[] {
  return recorded(path);
}
