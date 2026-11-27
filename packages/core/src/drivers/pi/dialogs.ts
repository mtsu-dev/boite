import { answerText } from '../../attachments.ts';
import { textOf } from './mapping.ts';
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
