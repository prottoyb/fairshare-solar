import {
  addMinutes,
  isAlignedToInterval,
  startOfUtcDay,
  toUtcDateString,
  utcDayRange,
  utcHourOfDay,
} from './time';

describe('startOfUtcDay / addMinutes / utcHourOfDay', () => {
  it('finds 00:00Z of the UTC day, whatever the offset written', () => {
    expect(
      startOfUtcDay(new Date('2026-10-20T09:30:00+10:00')).toISOString(),
    ).toBe('2026-10-19T00:00:00.000Z');
  });

  it('adds and subtracts minutes across midnight', () => {
    const t = new Date('2026-10-20T23:55:00Z');
    expect(addMinutes(t, 5).toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(addMinutes(t, -24 * 60).toISOString()).toBe(
      '2026-10-19T23:55:00.000Z',
    );
  });

  it('gives the fractional UTC hour', () => {
    expect(utcHourOfDay(new Date('2026-10-20T13:30:00Z'))).toBe(13.5);
    expect(utcHourOfDay(new Date('2026-10-20T00:00:00Z'))).toBe(0);
  });
});

describe('isAlignedToInterval', () => {
  it.each([
    '2026-10-20T03:05:00.000Z',
    '2026-10-20T00:00:00.000Z',
    '2026-10-20T23:55:00Z',
    '2026-10-20T13:35:00+10:00', // 03:35Z
  ])('accepts %s on a 5-minute grid', (iso) => {
    expect(isAlignedToInterval(new Date(iso), 5)).toBe(true);
  });

  it.each([
    '2026-10-20T03:03:00Z',
    '2026-10-20T03:05:01Z',
    '2026-10-20T03:05:00.001Z',
    '2026-10-20T13:33:00+05:30', // 08:03Z
  ])('rejects %s', (iso) => {
    expect(isAlignedToInterval(new Date(iso), 5)).toBe(false);
  });

  it('aligns in UTC, so half-hour offsets work', () => {
    // 13:35 +05:30 is 08:05Z.
    expect(isAlignedToInterval(new Date('2026-10-20T13:35:00+05:30'), 5)).toBe(
      true,
    );
  });

  it('respects other interval lengths', () => {
    expect(isAlignedToInterval(new Date('2026-10-20T03:15:00Z'), 15)).toBe(
      true,
    );
    expect(isAlignedToInterval(new Date('2026-10-20T03:05:00Z'), 15)).toBe(
      false,
    );
  });

  it('rejects an invalid Date', () => {
    expect(isAlignedToInterval(new Date('nope'), 5)).toBe(false);
  });
});

describe('utcDayRange', () => {
  it('returns [00:00Z, next day 00:00Z)', () => {
    const { start, end } = utcDayRange('2026-10-20');
    expect(start.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  it('rolls over month and year ends', () => {
    expect(utcDayRange('2026-02-28').end.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
    expect(utcDayRange('2026-12-31').end.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it.each(['2026-02-30', '2026-13-01', '20261020', '2026-10-20T00:00:00Z', ''])(
    'throws RangeError for %j',
    (bad) => {
      expect(() => utcDayRange(bad)).toThrow(RangeError);
    },
  );
});

describe('toUtcDateString', () => {
  it('uses the UTC date, not the local one', () => {
    expect(toUtcDateString(new Date('2026-10-20T23:55:00-05:00'))).toBe(
      '2026-10-21',
    );
  });

  it('throws for an invalid Date', () => {
    expect(() => toUtcDateString(new Date('nope'))).toThrow(RangeError);
  });
});
