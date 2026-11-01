import type { User } from './user.ts';

/** Everyone is in France: a month starts at midnight in Paris. */
const TIME_ZONE = 'Europe/Paris';
const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' });
const monthFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric' });

/** What a user spent this month against their limit. */
export type Quota = {
  /** `null`: no limit, for admins. */
  limitUsd: number | null;
  usedUsd: number;
  /** When the month ends and the spending starts again from zero. */
  resetsAt: Date;
};

/** The calendar month, in Paris time, that `now` belongs to. */
export function monthAround(now: Date): { start: Date; end: Date } {
  const parts = monthFormat.formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')!.value);
  const month = Number(parts.find((part) => part.type === 'month')!.value);
  return { start: parisMidnightOnFirst(year, month), end: parisMidnightOnFirst(year, month + 1) };
}

export function quotaLimit(user: User, defaultUsd: number): number | null {
  return user.role === 'admin' ? null : (user.monthlyQuotaUsd ?? defaultUsd);
}

/** Checked before each message: the message that crosses the limit is still answered, the next one is not. */
export function isExhausted(quota: Quota): boolean {
  return quota.limitUsd !== null && quota.usedUsd >= quota.limitUsd;
}

/** Whole percents, capped at 100; `0` without a limit. */
export function percentUsed(quota: Quota): number {
  if (quota.limitUsd === null) return 0;
  if (quota.limitUsd <= 0) return 100;
  return Math.min(100, Math.floor((quota.usedUsd / quota.limitUsd) * 100));
}

/** France never changes its clocks on the 1st: the offset an hour or two later is the offset at midnight. */
function parisMidnightOnFirst(year: number, month: number): Date {
  const utcMidnight = new Date(Date.UTC(year, month - 1, 1));
  return new Date(utcMidnight.getTime() - parisOffsetMinutes(utcMidnight) * 60_000);
}

function parisOffsetMinutes(date: Date): number {
  const name = offsetFormat.formatToParts(date).find((part) => part.type === 'timeZoneName')!.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}
