import type { MemoryEvent, Message } from '@boite/contracts';

type FailureKind = 'wake' | 'error' | undefined;

export function failureKind(message: Message): FailureKind {
  if (message.state === 'streaming') return;
  if (message.role === 'system' && message.parts.length > 0 && message.parts.every(part => part.type === 'text' && !part.moved && !part.newConversation && !part.started)) return 'wake';
  if (message.role === 'assistant' && message.parts.some(part => part.type === 'error') &&
    message.parts.every(part => part.type === 'error' || part.type === 'text' && !part.text.trim())) return 'error';
}

/** Only empty failed attempts fold together. Work, prompts and unloaded history keep their place. */
export function failedRun(timeline: readonly Message[], start: number, kindOf: (message: Message) => FailureKind, memory?: ReadonlyMap<string, MemoryEvent[]>, breaks?: ReadonlyMap<string, unknown>): Message[] | undefined {
  let attempts = 0;
  let at = start;
  while (at < timeline.length) {
    const first = timeline[at]!;
    const kind = kindOf(first);
    const wake = kind === 'wake' ? first : undefined;
    const error = wake ? timeline[at + 1] : first;
    if (!error || (wake ? kindOf(error) : kind) !== 'error' ||
      wake && wake.turnId !== error.turnId ||
      memory?.get(first.id)?.length || memory?.get(error.id)?.length ||
      at > start && breaks?.has(first.id) || wake && breaks?.has(error.id)) break;
    at += wake ? 2 : 1;
    attempts += 1;
  }
  return attempts > 1 ? timeline.slice(start, at) : undefined;
}
