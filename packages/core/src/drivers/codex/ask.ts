import type { QuestionAnswer } from '@boite/contracts';
import type { QuestionAsk, SessionContext } from '../types.ts';
import { answerTextOf, optionsOf, questionTextOf, textOf } from './mapping.ts';
import type { CodexQuestion } from './protocol.ts';
import type { CodexTurn } from './turn.ts';

// ---------------------------------------------------------------------------
// What the agent asks the user: permission cards, questions and elicitations
// ---------------------------------------------------------------------------

/**
 * An MCP server's elicitation. Codex routes its own MCP tool-call approvals
 * through it (`_meta.codex_approval_kind: "mcp_tool_call"`), and a server
 * may ask a plain yes or no as a form with nothing required: both become the
 * permission card, accepted with empty content. A form with required fields,
 * a url, or a device verification has no card yet and is declined, which
 * Codex reports as a refused call instead of a failed request.
 */
export async function answerElicitation(turn: CodexTurn | null, ctx: SessionContext, params: Record<string, unknown>): Promise<unknown> {
  const server = textOf(params['serverName']);
  const meta = (params['_meta'] ?? {}) as Record<string, unknown>;
  const schema = params['requestedSchema'] as { required?: unknown } | undefined;
  const required = Array.isArray(schema?.required) ? schema.required.length : 0;
  const confirmation = meta['codex_approval_kind'] === 'mcp_tool_call' || (params['mode'] === 'form' && required === 0);
  if (!confirmation) {
    ctx.log('warn', `codex: declined a ${textOf(params['mode']) || 'modeless'} elicitation from MCP server ${server || '(unnamed)'}, which boite cannot show`);
    return { action: 'decline' };
  }
  const decision = await askUser(
    turn,
    `mcp:${server}`,
    { message: textOf(params['message']), tool_title: meta['tool_title'] ?? null, tool_params: meta['tool_params'] ?? null },
    '',
  );
  return decision === 'accept' ? { action: 'accept', content: {} } : { action: decision };
}

/**
 * `item/tool/requestUserInput` carries one or more questions, each with its
 * own id and, sometimes, a list of options. Each becomes one question card,
 * they are asked in order, and the answers go back keyed by the question id
 * the server sent. A stop, or a turn that ends first, cancels the rest and
 * the request is answered with what was collected: leaving it unanswered
 * would hang the agent.
 */
export async function askQuestions(turn: CodexTurn | null, ctx: SessionContext, raw: unknown): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};
  if (turn === null || !Array.isArray(raw)) return answers;
  const entries = raw as CodexQuestion[];
  const idOf = (entry: CodexQuestion | undefined) => typeof entry?.id === 'string' ? entry.id : '';
  // Asked one at a time: each card says its place among those that will be asked.
  const total = entries.filter((entry) => idOf(entry).length > 0).length;
  let place = 0;
  for (const entry of entries) {
    if (turn.settled || turn.isStopped) break;
    const id = idOf(entry);
    if (id.length === 0) {
      ctx.log('warn', 'codex: a question with no id was skipped');
      continue;
    }
    place++;
    const options = optionsOf(entry.options);
    const answer = await askOne(turn, total > 1 ? { index: place, total } : undefined, {
      text: questionTextOf(entry),
      options,
      // A question the server marks `isOther`, or one with no options at all,
      // is the free-text case: there is nothing to pick otherwise.
      allowText: entry.isOther === true || options.length === 0,
      multiple: false,
    });
    if (answer === null) break;
    answers[id] = answerTextOf(answer, options);
  }
  return answers;
}

/**
 * An asynchronous question (GPT-6 Astra's `delivery: "async"`): the agent
 * goes on, so nothing waits here. The core folds the answer into the card
 * and brings it back with `turn/steer` or as the next prompt, framed as the
 * Codex TUI frames it: `> title`, a blank line, the answer.
 */
export function askAsync(turn: CodexTurn, question: { title?: string; options?: string[] | null }): void {
  const text = typeof question.title === 'string' ? question.title.trim() : '';
  if (text.length === 0) return;
  const ask: QuestionAsk = { text, options: optionsOf(question.options), allowText: true, multiple: false, async: true };
  const ticket = turn.ctx.askQuestion(ask);
  turn.part(turn.takeIndex(), { type: 'question', questionId: ticket.questionId, ...ask, answer: null });
}

/** One question card, drawn and then folded with what the user picked. */
async function askOne(turn: CodexTurn, series: { index: number; total: number } | undefined, ask: QuestionAsk): Promise<QuestionAnswer | null> {
  const ticket = turn.ctx.askQuestion(ask);
  const index = turn.takeIndex();
  const numbered = series ? { series } : {};
  turn.part(index, { type: 'question', questionId: ticket.questionId, ...ask, ...numbered, answer: null });
  const answer = await Promise.race([ticket, turn.stopped.then(() => null)]);
  if (answer === null) return null;
  turn.part(index, { type: 'question', questionId: ticket.questionId, ...ask, ...numbered, answer });
  return answer;
}

/** The inline permission card, and the Codex decision the answer becomes. */
export async function askUser(
  turn: CodexTurn | null,
  toolName: string,
  input: unknown,
  reason: string,
): Promise<'accept' | 'decline' | 'cancel'> {
  if (turn === null || turn.isStopped) return 'cancel';
  if (turn.ctx.thread.permissionMode === 'yolo') return 'accept';
  const ticket = turn.ctx.requestPermission(toolName, input, reason.length === 0 ? null : reason);
  const index = turn.takeIndex();
  turn.part(index, { type: 'permission', requestId: ticket.requestId, toolName, decision: null });
  const answer = await Promise.race([ticket, turn.stopped.then(() => 'cancelled' as const)]);
  if (answer === 'cancelled') return 'cancel';
  turn.part(index, { type: 'permission', requestId: ticket.requestId, toolName, decision: answer });
  // Stop denies the open card before it stops the turn: that deny is a
  // cancel, never the user's refusal.
  if (turn.isStopped) return 'cancel';
  return answer === 'allow' ? 'accept' : 'decline';
}
