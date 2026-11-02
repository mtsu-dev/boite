/*
 * The `window_guide` card each box posts in its conversation, which offers
 * the person Done and I cannot find it on every client of the owner, and is
 * folded once the box ends (docs/windows.md). The ids of the cards not folded
 * yet stay in a small journal table, so a core started after one that was
 * killed with a box showing folds each as `stopped`: no client keeps offering
 * Done on a box that is gone.
 */
import type { Message, MessagePart, WindowPointer } from '@boite/contracts';
import type { Core } from '../core.ts';
import { newId } from '../ids.ts';

type GuidePart = Extract<MessagePart, { type: 'window_guide' }>;
/** A posted card: its message, and the part as last written. */
export interface GuideCard { messageId: string; part: GuidePart }

export class GuideCards {
  readonly #core: Core;
  #tableReady = false;

  constructor(core: Core) {
    this.#core = core;
  }

  /** Posts the box's card; null with no turn to show it in. */
  post(threadId: string, boxId: string, pointer: WindowPointer): GuideCard | null {
    const journal = this.#core.journal;
    if (journal.isClosed()) return null;
    const turn = journal.runningTurn(threadId) ?? journal.lastTurn(threadId);
    if (turn === null) return null;
    const part: GuidePart = {
      type: 'window_guide', boxId, process: pointer.process, label: pointer.label,
      ...(pointer.control ? { control: { ...pointer.control } } : {}), ...(pointer.step ? { step: { ...pointer.step } } : {}),
      expiresAt: pointer.expiresAt, end: null,
    };
    const message: Message = { id: newId('msg_'), threadId, turnId: turn.id, role: 'assistant', parts: [part], state: 'complete', createdAt: Date.now() };
    journal.append({ type: 'message.started', threadId, version: 1, payload: message }, () => journal.putMessage(message));
    this.#table();
    journal.db.query('INSERT OR REPLACE INTO window_guide_cards (message_id, thread_id) VALUES (?, ?)').run(message.id, threadId);
    this.#core.bus.emit('message.started', message);
    this.#core.bus.emit('message.completed', { threadId, messageId: message.id, state: 'complete' });
    return { messageId: message.id, part };
  }

  /** Rewrites the card on every client, as a consent card is folded once answered; with `end`, it is folded for good. */
  fold(threadId: string, card: GuideCard, change: Partial<Pick<GuidePart, 'expiresAt' | 'end'>>): void {
    const journal = this.#core.journal;
    card.part = { ...card.part, ...change };
    if (journal.isClosed()) return;
    if (change.end) this.#forget(card.messageId);
    // A deleted conversation has no card left to fold.
    if (journal.getThread(threadId) === null) return;
    const part = card.part;
    journal.append(
      { type: 'message.part', threadId, version: 1, payload: { messageId: card.messageId, partIndex: 0, part } },
      () => journal.setMessagePart(card.messageId, 0, part),
    );
    this.#core.bus.emit('message.part', { threadId, messageId: card.messageId, partIndex: 0, part });
  }

  /**
   * At startup, before any box: each card a killed core left open ends as
   * `stopped`. Reads the one small table, and nothing when no box was ever shown.
   */
  recover(): void {
    const journal = this.#core.journal;
    if (journal.isClosed() || journal.db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'window_guide_cards'").get() === null) return;
    const open = journal.db.query('SELECT message_id, thread_id FROM window_guide_cards').all() as { message_id: string; thread_id: string }[];
    let folded = 0;
    for (const { message_id: messageId, thread_id: threadId } of open) {
      const found = journal.messagePart(messageId, 0)?.part;
      if (found?.type === 'window_guide' && found.end === null) {
        this.fold(threadId, { messageId, part: found }, { end: 'stopped' });
        folded += 1;
      } else {
        this.#forget(messageId);
      }
    }
    if (folded > 0) this.#core.logs.info(`Folded ${folded} window guide cards a stopped core left open`, { source: 'windows', event: 'window.recover', data: { cards: folded } });
  }

  #table(): void {
    if (this.#tableReady) return;
    this.#core.journal.db.exec('CREATE TABLE IF NOT EXISTS window_guide_cards (message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL) WITHOUT ROWID');
    this.#tableReady = true;
  }

  #forget(messageId: string): void {
    this.#table();
    this.#core.journal.db.query('DELETE FROM window_guide_cards WHERE message_id = ?').run(messageId);
  }
}
