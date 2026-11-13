import { selectionDiffers, statedSelection, type AccountId, type SwitchHandover, type SwitchSide, type Turn, type TurnSwitch } from '@boite/contracts';
import type { Core } from '../core.ts';

// A thread may change model, effort, speed, account or agent between two turns
// (`docs/internals/model-switching.md`). The turn that first runs on the new
// selection says so in the transcript: a divider above its first message,
// kept on the turn's own row. No message is written for it, so no agent reads
// it in a history and no count of messages moves.

/** What a history builder reports of the messages it put before a request (`CarriedHistory`). */
export type Carried = Omit<SwitchHandover, 'session'>;

function side(core: Core, selection: ReturnType<typeof statedSelection>): SwitchSide {
  return { ...selection, account: core.journal.getAccount(selection.accountId as AccountId)?.label ?? '' };
}

/**
 * The divider of a turn about to start, or undefined when it runs on what the
 * transcript last stated: the previous turn that started, at the effort and
 * speed it started on. A cache ping states nothing and takes none. A thread's
 * first turn has nothing to differ from.
 */
export function turnSwitch(core: Core, turn: Turn): TurnSwitch | undefined {
  const execution = turn.execution;
  if (!execution || execution.operation === 'keepalive') return undefined;
  const before = core.journal.statedTurn(turn.threadId, turn.id)?.execution;
  if (!before) return undefined;
  const from = statedSelection(before), to = statedSelection(execution);
  if (!selectionDiffers(from, to)) return undefined;
  return { from: side(core, from), to: side(core, to), ...(execution.accountLeft ? { reason: execution.accountLeft } : {}) };
}

/**
 * The prompt of `turn` was built for a new native session: its divider gains
 * what that session was handed. Only a change of account or agent starts one;
 * a model or effort change keeps its session and says the change alone. A
 * later fresh start of the same turn, after the agent lost the session it was
 * to resume, replaces the count. `turn` is the running turn's own object.
 */
export function recordHandover(core: Core, turn: Turn, session: SwitchHandover['session'], carried: Carried): void {
  const switched = turn.switched;
  if (!switched || switched.from.accountId === switched.to.accountId) return;
  const handover: SwitchHandover = { session, ...carried };
  const known = switched.handover;
  if (known && known.session === session && known.full === carried.full && known.cut === carried.cut && known.omitted === carried.omitted && known.chars === carried.chars) return;
  // A driver keeps its session's callbacks between turns: a late one must not rewrite a settled turn.
  if (core.journal.getTurn(turn.id)?.status !== 'running') return;
  turn.switched = { ...switched, handover };
  core.journal.putTurn(turn);
  core.bus.emit('turn.switched', { threadId: turn.threadId, turnId: turn.id, switched: turn.switched });
}
