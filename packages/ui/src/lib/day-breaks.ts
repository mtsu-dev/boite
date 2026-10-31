import type { Message } from '@boite/contracts';
import { longDay } from './format';
import { fill, strings } from './strings';

/**
 * Where a conversation changes day, local time: the messages that open a new
 * day get a divider above them. The first message held opens one too unless
 * it is from today, so an older thread says when it began and a fresh one
 * stays clean. Returns the ids of those messages and the day each opens.
 */
export function dayBreaks(timeline: readonly Pick<Message, 'id' | 'createdAt'>[], now = Date.now()): Map<string, number> {
  const breaks = new Map<string, number>();
  let day = dayOf(now);
  timeline.forEach((message, index) => {
    const next = dayOf(message.createdAt);
    if (next !== day || index === 0 && next !== dayOf(now)) breaks.set(message.id, message.createdAt);
    day = next;
  });
  return breaks;
}

/** The local day of a time, as a number that only changes at midnight. */
function dayOf(at: number): number {
  const date = new Date(at);
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate();
}

/** "Today", "Yesterday", or the day spelled out, with its year when it is not this one. */
export function dayLabel(at: number, now = Date.now()): string {
  const day = dayOf(at);
  if (day === dayOf(now)) return strings.chat.day.today;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === dayOf(yesterday.getTime())) return strings.chat.day.yesterday;
  const long = longDay(at);
  return new Date(at).getFullYear() === new Date(now).getFullYear() ? long : fill(strings.chat.day.withYear, { day: long, year: String(new Date(at).getFullYear()) });
}
