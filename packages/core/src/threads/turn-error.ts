import type { Message, MessageId, MessagePart, ThreadId, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { newId } from '../ids.ts';

// A turn that fails where no driver writes its error (before the agent
// started, or after the core that ran it died) still says why in its
// transcript: an error part the chat draws as the failure's card.

/** A message of `turn` opened for an error to live in, when the turn opened none. */
export function openTurnMessage(core: Core, turn: Turn): Message {
  const message: Message = { id: newId('msg_'), threadId: turn.threadId, turnId: turn.id, role: 'assistant', parts: [], state: 'streaming', createdAt: Date.now() };
  core.journal.append({ type: 'message.started', threadId: turn.threadId, version: 1, payload: message }, () => core.journal.putMessage(message));
  core.bus.emit('message.started', message);
  return message;
}

/** `reason` as the next part of the message. */
export function addErrorPart(core: Core, threadId: ThreadId, message: Pick<Message, 'id' | 'parts'>, reason: string): void {
  const partIndex = message.parts.length;
  const part: MessagePart = { type: 'error', message: reason };
  core.journal.append({ type: 'message.part', threadId, version: 1, payload: { messageId: message.id, partIndex, part } }, () => core.journal.setMessagePart(message.id, partIndex, part));
  core.bus.emit('message.part', { threadId, messageId: message.id, partIndex, part });
}

export function closeAsError(core: Core, threadId: ThreadId, messageId: MessageId): void {
  core.journal.append({ type: 'message.completed', threadId, version: 1, payload: { messageId, state: 'error' } }, () => core.journal.setMessageState(messageId, 'error'));
  core.bus.emit('message.completed', { threadId, messageId, state: 'error' });
}

/** A turn that failed before its agent started: one message holding why. */
export function writeTurnError(core: Core, turn: Turn, reason: string): void {
  const message = openTurnMessage(core, turn);
  addErrorPart(core, turn.threadId, message, reason);
  closeAsError(core, turn.threadId, message.id);
}
