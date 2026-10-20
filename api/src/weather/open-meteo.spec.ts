import { loadOpenMeteoFixture as loadFixture } from './__fixtures__/load-fixture';
import { OPEN_METEO_URL, parseOpenMeteo } from './open-meteo';

const MEL = 'Australia/Melbourne';
const local = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-AU', { timeZone: MEL, hour12: false });

describe('OPEN_METEO_URL', () => {
  it('asks for the Fawkner suburb centre, Melbourne time and unix timestamps', () => {
    expect(OPEN_METEO_URL).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=-37.707&longitude=144.968' +
        '&hourly=shortwave_radiation,cloud_cover,temperature_2m' +
        '&daily=sunrise,sunset,sunshine_duration,daylight_duration' +
        '&timezone=Australia%2FMelbourne&timeformat=unixtime&past_days=2&forecast_days=7',
    );
  });
});

describe('parseOpenMeteo (saved Fawkner fixture)', () => {
  const forecast = parseOpenMeteo(loadFixture(), MEL);

  it('reads nine local days, 18–26 October 2026', () => {
    expect([...forecast.days.keys()]).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
  });

  it('reads sunrise, sunset, sunshine and daylight for a day', () => {
    const day = forecast.days.get('2026-10-20')!;
    expect(local(day.sunrise)).toBe('06:28:40');
    expect(local(day.sunset)).toBe('19:41:50');
    expect(day.sunshineSeconds / 3600).toBeCloseTo(10.8, 1);
    expect(day.daylightSeconds / 3600).toBeCloseTo(13.2, 1);
  });

  it('reads 216 hourly means in time order, as ms timestamps', () => {
    expect(forecast.hourly).toHaveLength(216);
    const ends = forecast.hourly.map((h) => h.endsAt);
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);
    // The value labelled 13:00 local is the mean over 12:00–13:00.
    const at13 = forecast.hourly.find(
      (h) => h.endsAt === Date.parse('2026-10-20T02:00:00Z'),
    );
    expect(at13).toEqual({
      endsAt: Date.parse('2026-10-20T02:00:00Z'),
      irradianceWm2: 877,
      cloudCoverPct: 52,
      temperatureC: 26.6, // instantaneous at 13:00, not an hour mean
    });
  });

  it('parses a response without temperature as null temperatures', () => {
    const raw = loadFixture() as { hourly: Record<string, unknown> };
    delete raw.hourly.temperature_2m;
    const hourly = parseOpenMeteo(raw, MEL).hourly;
    expect(hourly).toHaveLength(216);
    expect(hourly.every((h) => h.temperatureC === null)).toBe(true);
  });

  it('is dark before sunrise: the hour ending 06:00 local averages 0 W/m²', () => {
    const at06 = forecast.hourly.find(
      (h) => h.endsAt === Date.parse('2026-10-19T19:00:00Z'),
    );
    expect(at06?.irradianceWm2).toBe(0);
  });

  it('rejects a response for the wrong time zone', () => {
    const wrong = { ...(loadFixture() as object), timezone: 'UTC' };
    expect(() => parseOpenMeteo(wrong, MEL)).toThrow(/time zone/);
  });

  it('rejects a malformed response', () => {
    expect(() => parseOpenMeteo({ timezone: MEL }, MEL)).toThrow(
      /missing hourly.time/,
    );
    expect(() => parseOpenMeteo(null, MEL)).toThrow();
  });

  it('skips hours with missing values instead of treating them as 0', () => {
    const raw = loadFixture() as {
      hourly: { shortwave_radiation: (number | null)[] };
    };
    raw.hourly.shortwave_radiation[13] = null;
    expect(parseOpenMeteo(raw, MEL).hourly).toHaveLength(215);
  });
});
