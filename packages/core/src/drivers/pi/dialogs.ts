import { answerText } from '../../attachments.ts';
import type { SessionContext } from '../types.ts';
import { textOf } from './mapping.ts';
import { UI_DIALOGS, UI_NOTICES } from './protocol.ts';
import type { PiPeer } from './rpc.ts';
import type { PiTurn } from './turn.ts';

/**
 * A `select`, `confirm`, `input` or `editor` dialog pi blocks on, drawn as a
 * question card in the running turn, and the answer sent back with its id: a
 * stop cancels it, and a dialog with a `timeout`, which pi resolves itself with
 * its default once the time is up, withdraws the card.
 */
export async function drawDialog(turn: PiTurn, peer: PiPeer, id: string, method: string, message: Record<string, unknown>): Promise<void> {
  const live = turn.ctx;
  const choices = Array.isArray(message['options']) ? message['options'].filter((option): option is string => typeof option === 'string') : [];
  const options = method === 'confirm'
    ? [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]
    : choices.map((label, index) => ({ id: String(index), label }));
  const ask = {
    text: [textOf(message['title']) || 'pi asks', textOf(message['message']), textOf(message['prefill'])].filter(Boolean).join('\n\n'),
    options, allowText: method === 'input' || method === 'editor', multiple: false,
  };
  const ticket = live.askQuestion(ask);
  const index = turn.takeIndex();
  turn.part(index, { type: 'question', questionId: ticket.questionId, ...ask, answer: null });
  // A dialog with a `timeout` resolves itself on pi's side with its default
  // once the time is up, and the agent goes on: the card goes with it.
  const timeout = typeof message['timeout'] === 'number' && message['timeout'] > 0 ? message['timeout'] : null;
  let timer: Timer | undefined;
  const expired = new Promise<'expired'>((resolve) => {
    if (timeout === null) return;
    timer = setTimeout(() => {
      resolve('expired');
    }, timeout);
    timer.unref?.();
  });
  const answer = await Promise.race([ticket, turn.stopped.then(() => null), expired]);
  clearTimeout(timer);
  if (answer === 'expired') {
    live.withdrawQuestion?.(ticket.questionId);
    turn.part(index, { type: 'question', questionId: ticket.questionId, ...ask, answer: null });
    return;
  }
  if (answer === null) { peer.answer({ type: 'extension_ui_response', id, cancelled: true }); return; }
  turn.part(index, { type: 'question', questionId: ticket.questionId, ...ask, answer });
  const value = method === 'select' ? options.find((option) => option.id === answer.optionIds[0])?.label : answerText(answer);
  peer.answer(method === 'confirm'
    ? { type: 'extension_ui_response', id, confirmed: answer.optionIds[0] === 'yes' }
    : { type: 'extension_ui_response', id, value });
}

/**
 * pi's only request back to the client. `select`, `confirm`, `input` and
 * `editor` block the agent until an answer with the same id arrives.
 */
export async function answerDialog(ctx: SessionContext, turn: PiTurn | null, peer: PiPeer | null, message: Record<string, unknown>): Promise<void> {
  const method = textOf(message['method']);
  if (UI_NOTICES.has(method)) {
    onNotice(ctx, turn, method, message);
    return;
  }
  const id = message['id'];
  // Nothing can be answered without the id the agent waits on, and nothing is
  // waiting once the process is gone.
  if (typeof id !== 'string') {
    ctx.log('warn', `pi: an ${method || 'unnamed'} dialog arrived with no id, nothing can answer it`);
    return;
  }
  if (peer === null) return;
  // `turn` is the one running now, not the one that opened the process: a warm
  // session outlives its first turn, and both the card and the journal row
  // belong to whoever is running when the dialog arrives.
  if (turn === null || !UI_DIALOGS.has(method)) {
    // A refusal is the answer pi defines for a dialog the client will not
    // draw. Dropping it silently leaves the extension blocked inside a
    // process that stays warm, on an id nobody will ever answer.
    const why = turn === null ? 'no turn is running' : 'boite draws no card for that method';
    ctx.log('warn', `pi: the ${method} dialog ${id} is refused, ${why}`);
    peer.answer({ type: 'extension_ui_response', id, cancelled: true });
    return;
  }
  await drawDialog(turn, peer, id, method, message);
}

/**
 * The UI methods pi expects no answer to. A `notify` is what an extension
 * command often says instead of running the model, so it is drawn in the
 * turn; an error notice is an error card, but it does not fail the turn.
 * Status lines, widgets, window titles and editor text have no place in a
 * chat and are dropped.
 */
function onNotice(ctx: SessionContext, turn: PiTurn | null, method: string, message: Record<string, unknown>): void {
  if (method !== 'notify') return;
  const text = textOf(message['message']);
  if (text.length === 0) return;
  if (turn === null) {
    ctx.log('info', `pi extension: ${text}`, { kind: 'provider-output', event: 'provider.output' });
    return;
  }
  turn.part(
    turn.takeIndex(),
    textOf(message['notifyType']) === 'error' ? { type: 'error', message: text } : { type: 'text', text: `pi: ${text}` },
  );
}
