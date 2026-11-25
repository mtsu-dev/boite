import type { Message } from '@boite/contracts';

/** What a tap on a control does to the row: one in the open row keeps it, any other only closes it. */
const CONTROL = 'button, a, input, textarea, select, summary, label, [role="button"], [contenteditable="true"]';

/**
 * A phone draws a message's buttons under the last prompt and the last answer
 * only; any other message shows its row once tapped, until the next tap on it
 * or anywhere else. `attrs` marks each row for the rule in app.css; a desktop
 * keeps the buttons on every message.
 */
export class MessageReveal {
  revealed = $state<string | null>(null);
  #messages: () => Message[];
  #phone: () => boolean;
  #lastPrompt = $derived.by(() => this.#messages().findLast((message) => message.role === 'user')?.id ?? null);
  #drawn: () => readonly Message[];
  /**
   * The turn of the last answer drawn, read from the timeline as it is drawn (`drawn`): a queued or unanswered turn
   * after it has none, and a cache ping's reply, an automatic compaction and a folded quiet wake draw no answer.
   */
  #lastAnswer = $derived.by(() => this.#drawn().findLast((message) => message.role === 'assistant')?.turnId ?? null);

  constructor(messages: () => Message[], phone: () => boolean, drawn: () => readonly Message[] = messages) {
    this.#messages = messages;
    this.#phone = phone;
    this.#drawn = drawn;
    $effect(() => {
      if (this.revealed === null) return;
      const away = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest(`[data-reveal="${this.revealed}"]`)) this.revealed = null; };
      window.addEventListener('pointerdown', away, true);
      return () => window.removeEventListener('pointerdown', away, true);
    });
  }

  key(message: Message): string { return message.role === 'user' ? `prompt:${message.id}` : `turn:${message.turnId}`; }

  #latest(message: Message): boolean {
    return message.role === 'user' ? message.id === this.#lastPrompt : message.turnId === this.#lastAnswer;
  }

  /** A row's marks: its key, and whether its buttons show. */
  attrs(message: Message): Record<string, string | undefined> {
    const key = this.key(message);
    return { 'data-reveal': key, 'data-latest': this.#latest(message) ? '' : undefined, 'data-revealed': this.revealed === key ? '' : undefined };
  }

  /** Whether the message's buttons show: always on a desktop, on a phone under the latest ones and the one tapped. */
  shows(message: Message): boolean {
    return !this.#phone() || this.#latest(message) || this.revealed === this.key(message);
  }

  /** A tap in the timeline: on a message it shows or hides that message's row. A selection is being read, not tapped. */
  tap = (event: MouseEvent): void => {
    if (!this.#phone() || !(event.target instanceof Element)) return;
    const key = event.target.closest<HTMLElement>('[data-reveal]')?.dataset.reveal ?? null;
    if (event.target.closest(CONTROL)) {
      if (key !== this.revealed) this.revealed = null;
      return;
    }
    if (window.getSelection()?.isCollapsed === false) return;
    this.revealed = key !== null && key !== this.revealed ? key : null;
  };
}
