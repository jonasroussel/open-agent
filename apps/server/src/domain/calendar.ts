const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// Calendar days, as YYYY-MM-DD: counted in UTC, so clock changes never make a day 23 or 25 hours long.

/** `null` for anything but a real date: "2026-02-30" is not one. */
export function parseDay(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function weekdayOf(date: Date): string {
  return WEEKDAYS[date.getUTCDay()]!;
}

/** Negative when `to` comes first. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
