/** Interval alignment and UTC-day helpers. Pure: no framework imports. */

const MS_PER_MINUTE = 60_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `date` sits exactly on an interval boundary in UTC (seconds and ms are 0
 * and the minutes are a multiple of the interval). Works for any interval that
 * divides a day, because the Unix epoch is itself a UTC midnight.
 */
export function isAlignedToInterval(
  date: Date,
  intervalMinutes: number,
): boolean {
  const t = date.getTime();
  return Number.isFinite(t) && t % (intervalMinutes * MS_PER_MINUTE) === 0;
}

/** The UTC day `[date 00:00Z, next day 00:00Z)` for a `YYYY-MM-DD` string. */
export function utcDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_ONLY.test(date) || toUtcDateString(start) !== date) {
    throw new RangeError(`"${date}" is not a valid YYYY-MM-DD date`);
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/** `YYYY-MM-DD` of the UTC day containing `date`. Throws for an invalid Date. */
export function toUtcDateString(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('invalid Date');
  }
  return date.toISOString().slice(0, 10);
}
