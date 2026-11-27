import { ATTACHMENTS_PER_TURN, ATTACHMENTS_TOTAL_MAX_BYTES, decodedBytes, type ImageAttachment, type Message, type MessagePart, type TurnId } from '@boite/contracts';
import type { HistoryInput, PartPlace } from '../continuation.ts';
import type { Journal } from '../journal.ts';
import { nativeCommandPrompt } from './operations.ts';

type FilePart = Extract<MessagePart, { type: 'file' }>;

/**
 * Stop can win before a provider saves the prompt, even when an older native
 * session exists. Carry interrupted user input until a later user turn succeeds
 * or the live process confirms it received the interrupted input.
 * Read the journal rather than consuming a queue, so another stop or restart
 * cannot lose it. Native commands and automatic turns do not consume it.
 * With `through`, the walk starts after `turnId` instead of before it: a
 * resumed session's last turn (`threads/account-sessions.ts`), whose own
 * prompt counts.
 */
export function stoppedInput(
  journal: Journal,
  threadId: string,
  turnId: TurnId,
  input: HistoryInput,
  fileReference: (file: FilePart, place: PartPlace) => string,
  through = false,
  receivedTurns?: ReadonlySet<TurnId>,
): { input: HistoryInput; received?: TurnId } {
  const opening = journal.db.query(through
    ? 'SELECT MAX(rowid) + 1 AS first FROM messages WHERE thread_id = ? AND turn_id = ?'
    : 'SELECT MIN(rowid) AS first FROM messages WHERE thread_id = ? AND turn_id = ?').get(threadId, turnId) as { first: number | null };
  if (opening.first === null) return { input };
  // Read user rows and resume notes without blobs until a completed request: assistant/tool
  // payloads are irrelevant, and stopped attachments load only when carried.
  const statement = journal.db.prepare("SELECT id, turn_id AS turnId, role, parts FROM messages WHERE thread_id = ? AND role IN ('user', 'system') AND rowid < ? ORDER BY rowid DESC");
  const messages: Message[] = [];
  let received: TurnId | undefined;
  try {
    for (const row of statement.iterate(threadId, opening.first) as Iterable<{ id: string; turnId: TurnId; role: 'user' | 'system'; parts: string }>) {
      const turn = journal.getTurn(row.turnId);
      if (row.role === 'system') {
        // A completed resume carried the source request and its interrupted context.
        if (turn?.status === 'done' && turn.execution?.resumeSourceTurnId !== undefined) break;
        continue;
      }
      if (!turn || turn.execution?.operation || turn.execution?.automatic) continue;
      const parts = JSON.parse(row.parts) as MessagePart[];
      if (nativeCommandPrompt(parts.filter(part => part.type === 'text').map(part => part.text).join(''))) continue;
      if (turn.status === 'done') break;
      if (turn.status === 'stopped' || (turn.status === 'error' && turn.execution?.queuedInputInterrupted)) {
        // The acknowledged prompt already carried the older stopped input.
        if (turn.execution?.queuedInputSession !== undefined && receivedTurns?.has(turn.id)) {
          received = turn.id;
          break;
        }
        const message = journal.getMessage(row.id);
        if (message) messages.push(message);
      }
    }
  } finally { statement.finalize(); }
  if (messages.length === 0) return { input, received };
  messages.reverse();
  const images = messages.flatMap(message => message.parts.filter(part => part.type === 'image'));
  // The newest images, within the count and the byte total the current attachments leave; older ones go as files.
  const slots = ATTACHMENTS_PER_TURN - input.attachments.length;
  let room = ATTACHMENTS_TOTAL_MAX_BYTES - input.attachments.reduce((sum, part) => sum + decodedBytes(part.data), 0);
  const kept = new Set<(typeof images)[number]>();
  for (const image of images.toReversed()) {
    room -= decodedBytes(image.data);
    if (kept.size >= slots || room < 0) break;
    kept.add(image);
  }
  const attachments: ImageAttachment[] = [];
  const history = messages.map(message => {
    const parts = message.parts.map((part, partIndex) => {
      const place = { messageId: message.id, partIndex };
      if (part.type === 'text') return (part.moved?.note ?? '') + part.text;
      if (part.type === 'file') return fileReference(part, place);
      if (part.type !== 'image') return '';
      if (!kept.has(part)) return fileReference({ type: 'file', mimeType: part.mimeType, data: part.data, name: part.alt }, place);
      attachments.push({ kind: 'image', mimeType: part.mimeType, data: part.data, name: part.alt });
      return `[Image: ${part.alt ?? 'attachment'}]`;
    }).filter(Boolean).join('\n');
    return `[Earlier interrupted user message]\n${parts}`;
  }).join('\n\n');
  return {
    received,
    input: {
      prompt: `Earlier user messages were interrupted and may be missing from your native session. Keep them as conversation context; the current user request determines what to do next. Do not repeat completed work.\n\n<interrupted-user-messages>\n${history}\n</interrupted-user-messages>\n\nCurrent user request:\n${input.prompt}`,
      attachments: [...attachments, ...input.attachments],
      historicalImages: [...attachments, ...(input.historicalImages ?? [])],
    },
  };
}
