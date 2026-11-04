import { afterEach, expect, test } from 'vitest';
import { readabilityThread } from './readability-thread';

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const dayOf = (at: number) => new Date(at).toDateString();
const daysBefore = (now: number, count: number) => {
  const day = new Date(now);
  day.setDate(day.getDate() - count);
  return dayOf(day.getTime());
};

test('the thread spans two days ago, yesterday and today, nothing in the future, at any hour and across a clock change', () => {
  process.env.TZ = 'Europe/Paris';
  // Midnight exactly and a few minutes after it, a morning, the last minute of a day, and the days after both 2026 clock changes.
  const clocks: [number, number, number, number][] = [[10, 4, 0, 0], [10, 4, 0, 3], [10, 4, 0, 9], [10, 4, 9, 0], [10, 4, 23, 59], [2, 30, 0, 3], [9, 26, 23, 59]];
  for (const [month, date, hours, minutes] of clocks) {
    const now = new Date(2026, month, date, hours, minutes).getTime();
    const thread = readabilityThread(now);
    const days = [...new Set(thread.messages.map(message => dayOf(message.createdAt)))];
    const label = new Date(now).toString();
    expect(days, label).toEqual([daysBefore(now, 2), daysBefore(now, 1), dayOf(now)]);
    expect(thread.messages.filter(message => message.createdAt > now), label).toEqual([]);
  }
});
