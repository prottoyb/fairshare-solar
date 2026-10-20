/**
 * Local-time helpers for a named IANA time zone, built on Intl.DateTimeFormat (no
 * date library). Instants stay UTC everywhere; these give the site's local date,
 * hour and day boundaries, including daylight-saving days. Pure: no framework imports.
 */
import { toUtcDateString } from './time';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function localParts(date: Date, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Local clock time minus UTC, in ms, at `date` (e.g. +11 h during AEDT). */
function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the local day containing `date`. */
export function localDateString(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Fractional local hour, e.g. 06:30 local → 6.5. */
export function localHourOfDay(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  return p.hour + p.minute / 60;
}

/** A `YYYY-MM-DD` string `days` calendar days later (negative goes back). */
export function addDaysToDateString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toUtcDateString(d);
}

/** The UTC instant of local midnight starting `date`. */
function localMidnight(date: string, timeZone: string): Date {
  const guess = Date.parse(`${date}T00:00:00.000Z`);
  // Two passes settle the offset; local midnight never falls in a DST gap here.
  let t = guess - offsetMs(new Date(guess), timeZone);
  t = guess - offsetMs(new Date(t), timeZone);
  return new Date(t);
}

/** The local day `[date 00:00 local, next day 00:00 local)`, as UTC instants. */
export function localDayRange(
  date: string,
  timeZone: string,
): { start: Date; end: Date } {
  if (
    !DATE_ONLY.test(date) ||
    toUtcDateString(new Date(`${date}T00:00:00.000Z`)) !== date
  ) {
    throw new RangeError(`"${date}" is not a valid YYYY-MM-DD date`);
  }
  return {
    start: localMidnight(date, timeZone),
    end: localMidnight(addDaysToDateString(date, 1), timeZone),
  };
}

/** Local midnight (as a UTC instant) of the local day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  return localDayRange(localDateString(date, timeZone), timeZone).start;
}

/** Intervals in a local day: 288 normally, 276 / 300 on daylight-saving days. */
export function intervalsInLocalDay(
  date: string,
  timeZone: string,
  intervalMinutes: number,
): number {
  const { start, end } = localDayRange(date, timeZone);
  return (end.getTime() - start.getTime()) / (intervalMinutes * 60_000);
}
