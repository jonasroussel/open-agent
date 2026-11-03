import { describe, expect, test } from 'bun:test';

import { daysBetween, formatDay, parseDay, plusDays, weekdayOf } from './calendar.ts';

describe('calendar', () => {
  test('only real dates parse', () => {
    expect(parseDay('2028-02-29')).not.toBeNull();
    expect(parseDay('2026-02-29')).toBeNull();
    expect(parseDay('2026-13-01')).toBeNull();
    expect(parseDay('3 mars')).toBeNull();
  });

  test('counts whole days across a clock change and a leap day, either way', () => {
    const march = parseDay('2028-03-20')!;
    const april = parseDay('2028-04-03')!;
    expect(daysBetween(march, april)).toBe(14);
    expect(daysBetween(april, march)).toBe(-14);
    expect(daysBetween(parseDay('2028-02-28')!, parseDay('2028-03-01')!)).toBe(2);
  });

  test('adds days into the next year and names the weekday', () => {
    const result = plusDays(parseDay('2026-12-20')!, 45);
    expect(formatDay(result)).toBe('2027-02-03');
    expect(weekdayOf(result)).toBe('Wednesday');
  });
});
