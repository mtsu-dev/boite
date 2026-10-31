import { RpcErrorCode } from '@boite/contracts';
import { RpcFailure } from './rpc-error';
import { secureId } from './secure-id';

/**
 * One move of a bot keeps one `requestId` until it ends (`agents.move`). The
 * core answers the same id with the same move: when the target made the bot
 * and the answer was lost, trying again with that id finishes the move on the
 * machine it leaves, where a new id would find the bot on both and be refused.
 * The id lives in this window's storage, keyed by the machine that holds the
 * bot, the bot and the target, so it survives a reload and a reconnection.
 */
const STORAGE_KEY = 'boite.agentMoves';

/** The refusals after which the same move may still finish: the bot is busy, on its way, or the answer did not come back. */
const UNFINISHED = new Set(['unreachable', 'moving', 'turn-in-flight', 'unread-answer', 'facts-arriving']);

const keyOf = (machine: string, agentId: string, target: string) => JSON.stringify([machine, agentId, target]);

function read(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { return {}; }
}

function write(moves: Record<string, string>): void {
  try {
    if (Object.keys(moves).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(moves));
  } catch { /* storage refused: the id lasts as long as this page */ }
}

/** The `requestId` of the move of `agentId` from `machine` to `target`: the one still unfinished, else a new one kept now. */
export function moveRequestId(machine: string, agentId: string, target: string): string {
  const moves = read();
  const key = keyOf(machine, agentId, target);
  const kept = moves[key];
  if (kept) return kept;
  const id = secureId();
  write({ ...moves, [key]: id });
  return id;
}

/** The move ended, moved or finally refused: the next one gets a new id. */
export function moveEnded(machine: string, agentId: string, target: string): void {
  const moves = read();
  const key = keyOf(machine, agentId, target);
  if (!(key in moves)) return;
  delete moves[key];
  write(moves);
}

/**
 * Whether a failed move is over: a refusal that read the request and said no.
 * A lost connection, a silent target or a busy bot is not: the same id goes
 * again with the next try.
 */
export function moveRefusedForGood(error: unknown): boolean {
  if (!(error instanceof RpcFailure)) return false;
  if (error.code !== RpcErrorCode.Refused && error.code !== RpcErrorCode.InvalidParams && error.code !== RpcErrorCode.NotFound) return false;
  const reason = (error.data as { reason?: unknown } | undefined)?.reason;
  return typeof reason !== 'string' || !UNFINISHED.has(reason);
}
