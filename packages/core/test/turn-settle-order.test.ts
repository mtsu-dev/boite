import { expect, test } from 'bun:test';
import { AcpTurn } from '../src/drivers/acp/turn.ts';
import { CodexTurn } from '../src/drivers/codex/turn.ts';
import { MuseTurn } from '../src/drivers/muse/turn.ts';
import { PiTurn } from '../src/drivers/pi/turn.ts';

interface SettlingTurn {
  sessionId: string | null;
  done: Promise<{ sessionId?: string | null }>;
  part(index: number, part: { type: 'text'; text: string }): void;
  takeIndex(): number;
  settle(): void;
}

const turns: [string, new (ctx: never) => SettlingTurn][] = [
  ['acp', AcpTurn as never],
  ['codex', CodexTurn as never],
  ['muse', MuseTurn as never],
  ['pi', PiTurn as never],
];

// The sink emits `message.completed` synchronously, so what a subscriber changes
// there must be what the turn then reports.
test.each(turns)('the %s turn closes its message before it reads its result', async (_name, Turn) => {
  const holder: { turn?: SettlingTurn } = {};
  const ctx = {
    sessionId: 'original',
    provider: { id: 'pi' },
    thread: { model: 'default' },
    turn: {},
    context() {},
    emit: {
      startMessage: () => 'message',
      part() {},
      delta() {},
      complete() {
        holder.turn!.sessionId = 'changed-by-complete';
      },
    },
  };
  const turn = new Turn(ctx as never);
  holder.turn = turn;
  turn.part(turn.takeIndex(), { type: 'text', text: 'x' });
  turn.settle();
  expect((await turn.done).sessionId).toBe('changed-by-complete');
});
