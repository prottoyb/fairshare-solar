import {
  addDaysToDateString,
  intervalsInLocalDay,
  localDateString,
  localDayRange,
  localHourOfDay,
  startOfLocalDay,
} from './local-time';

const MEL = 'Australia/Melbourne';
const iso = (d: Date) => d.toISOString();

describe('localDateString / localHourOfDay (Melbourne)', () => {
  it('uses the Melbourne date, not the UTC one', () => {
    // AEDT is UTC+11 in October.
    expect(localDateString(new Date('2026-10-19T12:59:00Z'), MEL)).toBe(
      '2026-10-19',
    );
    expect(localDateString(new Date('2026-10-19T13:00:00Z'), MEL)).toBe(
      '2026-10-20',
    );
  });

  it('gives the fractional local hour', () => {
    expect(localHourOfDay(new Date('2026-10-19T19:30:00Z'), MEL)).toBe(6.5);
    // AEST is UTC+10 in July.
    expect(localHourOfDay(new Date('2026-07-01T02:15:00Z'), MEL)).toBe(12.25);
  });

  it('jumps from 02:00 to 03:00 when daylight saving starts (2026-10-04)', () => {
    expect(localHourOfDay(new Date('2026-10-03T15:55:00Z'), MEL)).toBeCloseTo(
      1 + 55 / 60,
      10,
    );
    expect(localHourOfDay(new Date('2026-10-03T16:00:00Z'), MEL)).toBe(3);
  });

  it('repeats 02:00–03:00 when daylight saving ends (2026-04-05)', () => {
    // 02:30 AEDT, then an hour later 02:30 AEST.
    expect(localHourOfDay(new Date('2026-04-04T15:30:00Z'), MEL)).toBe(2.5);
    expect(localHourOfDay(new Date('2026-04-04T16:30:00Z'), MEL)).toBe(2.5);
  });
});

describe('localDayRange (Melbourne)', () => {
  it('returns local midnight to local midnight, in UTC', () => {
    const { start, end } = localDayRange('2026-10-20', MEL);
    expect(iso(start)).toBe('2026-10-19T13:00:00.000Z');
    expect(iso(end)).toBe('2026-10-20T13:00:00.000Z');
  });

  it('uses AEST (UTC+10) in winter', () => {
    const { start, end } = localDayRange('2026-07-01', MEL);
    expect(iso(start)).toBe('2026-06-30T14:00:00.000Z');
    expect(iso(end)).toBe('2026-07-01T14:00:00.000Z');
  });

  it('has 288 intervals on a normal day', () => {
    expect(intervalsInLocalDay('2026-10-20', MEL, 5)).toBe(288);
  });

  it('has 276 intervals on the 23-hour day daylight saving starts (2026-10-04)', () => {
    const { start, end } = localDayRange('2026-10-04', MEL);
    expect(iso(start)).toBe('2026-10-03T14:00:00.000Z'); // 00:00 AEST
    expect(iso(end)).toBe('2026-10-04T13:00:00.000Z'); // 00:00 AEDT
    expect(intervalsInLocalDay('2026-10-04', MEL, 5)).toBe(276);
  });

  it('has 300 intervals on the 25-hour day daylight saving ends (2026-04-05)', () => {
    const { start, end } = localDayRange('2026-04-05', MEL);
    expect(iso(start)).toBe('2026-04-04T13:00:00.000Z'); // 00:00 AEDT
    expect(iso(end)).toBe('2026-04-05T14:00:00.000Z'); // 00:00 AEST
    expect(intervalsInLocalDay('2026-04-05', MEL, 5)).toBe(300);
  });

  it.each(['2026-02-30', '2026-13-01', '20261020', '2026-10-20T00:00:00Z', ''])(
    'throws RangeError for %j',
    (bad) => {
      expect(() => localDayRange(bad, MEL)).toThrow(RangeError);
    },
  );
});

describe('startOfLocalDay / addDaysToDateString', () => {
  it('finds local midnight of the day containing an instant', () => {
    expect(iso(startOfLocalDay(new Date('2026-10-20T08:17:00Z'), MEL))).toBe(
      '2026-10-19T13:00:00.000Z',
    );
  });

  it('adds calendar days across month and year ends', () => {
    expect(addDaysToDateString('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateString('2026-10-20', -1)).toBe('2026-10-19');
  });
});
