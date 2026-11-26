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
  #lastAnswer: () => string | null;
  #focused: () => string | null;

  constructor(
    messages: () => Message[],
    phone: () => boolean,
    lastAnswer: () => string | null = () => messages().findLast((message) => message.role === 'assistant')?.turnId ?? null,
    focused: () => string | null = () => null,
  ) {
    this.#messages = messages;
    this.#phone = phone;
    this.#lastAnswer = lastAnswer;
    this.#focused = focused;
    $effect(() => {
      if (this.revealed === null) return;
      const away = (event: PointerEvent) => { if (!(event.target instanceof Element) || !this.#withinRevealed(event.target)) this.revealed = null; };
      window.addEventListener('pointerdown', away, true);
      return () => window.removeEventListener('pointerdown', away, true);
    });
  }

  #withinRevealed(target: Element): boolean {
    return this.revealed !== null && target.closest(`[data-reveal="${this.revealed}"]`) !== null;
  }

  key(message: Message): string { return message.role === 'user' ? `prompt:${message.id}` : `turn:${message.turnId}`; }

  #latest(message: Message): boolean {
    return message.role === 'user' ? message.id === this.#lastPrompt : message.turnId === this.#lastAnswer();
  }

  #shown(message: Message, key: string): boolean {
    return this.revealed === key || (message.role !== 'user' && this.#focused() === message.turnId);
  }

  /** A row's marks: its key, and whether its buttons show. */
  attrs(message: Message): Record<string, string | undefined> {
    const key = this.key(message);
    return { 'data-reveal': key, 'data-latest': this.#latest(message) ? '' : undefined, 'data-revealed': this.#shown(message, key) ? '' : undefined };
  }

  /** Whether the message's buttons show: always on a desktop, on a phone under the latest ones, the one tapped, or the one holding focus. */
  shows(message: Message): boolean {
    return !this.#phone() || this.#latest(message) || this.#shown(message, this.key(message));
  }

  /** Whether a turn's summary line shows on a phone, independent of whether its closing row is a steering prompt. */
  showsTurn(turnId: string): boolean {
    return !this.#phone() || turnId === this.#lastAnswer() || this.revealed === `turn:${turnId}` || this.#focused() === turnId;
  }

  /** A tap in the timeline: on a message it shows or hides that message's row. A selection is being read, not tapped. */
  tap = (event: MouseEvent): void => {
    if (!this.#phone() || !(event.target instanceof Element)) return;
    if (event.target.closest(CONTROL)) {
      if (this.revealed !== null && !this.#withinRevealed(event.target)) this.revealed = null;
      return;
    }
    const key = event.target.closest<HTMLElement>('[data-reveal]')?.dataset.reveal ?? null;
    if (window.getSelection()?.isCollapsed === false) return;
    this.revealed = key !== null && key !== this.revealed ? key : null;
  };
}
