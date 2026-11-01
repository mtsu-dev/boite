import { expect, test } from 'vitest';
import { dayBreaks, dayDate, dayLabel } from './day-breaks';

const NOW = new Date(2026, 9, 31, 12, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

test('a divider opens each new local day, and the first message only when it is not from today', () => {
  const timeline = [
    { id: 'a', createdAt: at(29, 15) }, { id: 'b', createdAt: at(29, 23) },
    { id: 'c', createdAt: at(30, 0) }, { id: 'd', createdAt: at(31, 10) }, { id: 'e', createdAt: at(31, 11) },
  ];
  expect([...dayBreaks(timeline, NOW).keys()]).toEqual(['a', 'c', 'd']);
  expect([...dayBreaks(timeline.slice(3), NOW).keys()]).toEqual([]);
});

test('a day reads today, yesterday, or spelled out with its year when it is another', () => {
  expect(dayLabel(at(31, 9), NOW)).toBe('Today');
  expect(dayLabel(at(30, 23), NOW)).toBe('Yesterday');
  expect(dayLabel(at(29, 9), NOW)).toMatch(/Thursday.*29|29.*Thursday/);
  expect(dayLabel(new Date(2025, 11, 31).getTime(), NOW)).toMatch(/2025$/);
});

test('the machine-readable day is the local day the chip names, not the UTC one', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    // 00:30 in Tokyo is still the day before in UTC.
    expect(dayDate(new Date(2026, 9, 31, 0, 30).getTime())).toBe('2026-10-31');
  } finally {
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});
