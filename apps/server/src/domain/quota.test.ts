import { describe, expect, test } from 'bun:test';

import { isExhausted, monthAround, percentUsed } from './quota.ts';

describe('monthAround', () => {
  test('a month runs from midnight on the 1st in Paris, winter or summer time', () => {
    expect(monthAround(new Date('2026-11-15T12:00:00Z'))).toEqual({
      start: new Date('2026-10-31T23:00:00Z'),
      end: new Date('2026-11-30T23:00:00Z'),
    });
    expect(monthAround(new Date('2026-07-10T12:00:00Z'))).toEqual({
      start: new Date('2026-06-30T22:00:00Z'),
      end: new Date('2026-07-31T22:00:00Z'),
    });
  });

  test('just after midnight in Paris on the 1st is already the new month, though still the old one in UTC', () => {
    expect(monthAround(new Date('2026-11-30T23:30:00Z')).start).toEqual(new Date('2026-11-30T23:00:00Z'));
  });

  test('December ends on the 1st of January', () => {
    expect(monthAround(new Date('2026-12-20T12:00:00Z')).end).toEqual(new Date('2026-12-31T23:00:00Z'));
  });
});

describe('quota', () => {
  const resetsAt = new Date('2026-11-30T23:00:00Z');
  const quota = (limitUsd: number | null, usedUsd: number, ownKey = false) => ({ limitUsd, usedUsd, resetsAt, ownKey });

  test('is used up once the spending reaches the limit, never without a limit', () => {
    expect(isExhausted(quota(5, 4.99))).toBe(false);
    expect(isExhausted(quota(5, 5))).toBe(true);
    expect(isExhausted(quota(null, 1000))).toBe(false);
  });

  test('shows whole percents, capped at 100; a zero limit is full', () => {
    expect(percentUsed(quota(5, 3.27))).toBe(65);
    expect(percentUsed(quota(5, 6))).toBe(100);
    expect(percentUsed(quota(0, 0))).toBe(100);
  });

  test("an own key lifts the limit, even when the app's spending already reached it", () => {
    expect(isExhausted(quota(5, 7, true))).toBe(false);
    expect(percentUsed(quota(5, 7, true))).toBe(0);
  });
});
