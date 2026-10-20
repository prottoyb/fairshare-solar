import { Logger } from '@nestjs/common';
import { loadOpenMeteoFixture } from './__fixtures__/load-fixture';
import {
  WEATHER_CACHE_TTL_MS,
  WEATHER_RETRY_AFTER_MS,
  WeatherService,
} from './weather.service';
import { WeatherProvider } from './weather.provider';

// Never touches the network: the provider is a fake around the saved fixture,
// and the clock is a variable the tests move.
describe('WeatherService', () => {
  const MIN = 60_000;
  let now: number;
  let fetchForecast: jest.Mock<Promise<unknown>, []>;
  let service: WeatherService;
  let warn: jest.SpyInstance<void, [message: string]>;

  beforeEach(() => {
    now = Date.parse('2026-10-20T01:00:00.000Z'); // 12:00 in Fawkner
    fetchForecast = jest.fn(() => Promise.resolve(loadOpenMeteoFixture()));
    const provider: WeatherProvider = { fetchForecast };
    service = new WeatherService(provider, () => now);
    // Logger.warn is overloaded; the tests only read the first argument.
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {}) as unknown as jest.SpyInstance<
      void,
      [message: string]
    >;
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('returns the day from Open-Meteo and fills the cache for every date in the response', async () => {
    const today = await service.forDate('2026-10-20');
    expect(today.source).toBe('open-meteo');
    if (today.source === 'open-meteo') {
      expect(today.day.date).toBe('2026-10-20');
      expect(today.day.sunrise).toBe(Date.parse('2026-10-19T19:28:40Z')); // 06:28:40 local
    }
    expect((await service.forDate('2026-10-23')).source).toBe('open-meteo');
    expect((await service.forDate('2026-10-19')).source).toBe('open-meteo');
    expect(fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('refetches today after an hour but keeps past dates forever', async () => {
    await service.forDate('2026-10-20');
    now += WEATHER_CACHE_TTL_MS - MIN;
    await service.forDate('2026-10-20');
    expect(fetchForecast).toHaveBeenCalledTimes(1);

    now += 2 * MIN; // past the hour
    await service.forDate('2026-10-19'); // yesterday: still cached
    expect(fetchForecast).toHaveBeenCalledTimes(1);
    await service.forDate('2026-10-20'); // today: refetched
    expect(fetchForecast).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch between concurrent callers', async () => {
    const results = await Promise.all(
      ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-20'].map((d) =>
        service.forDate(d),
      ),
    );
    expect(results.every((r) => r.source === 'open-meteo')).toBe(true);
    expect(fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('falls back for a date outside the response, warns once and does not refetch', async () => {
    expect((await service.forDate('2026-11-30')).source).toBe('fallback');
    expect((await service.forDate('2026-11-30')).source).toBe('fallback');
    expect(fetchForecast).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/2026-11-30.*clear-sky/);
  });

  it('falls back when the API fails, and retries only after 60 s', async () => {
    fetchForecast.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect((await service.forDate('2026-10-20')).source).toBe('fallback');
    expect(warn.mock.calls[0][0]).toMatch(
      /Weather fetch failed \(ECONNRESET\)/,
    );

    now += WEATHER_RETRY_AFTER_MS - 1000;
    expect((await service.forDate('2026-10-20')).source).toBe('fallback');
    expect(fetchForecast).toHaveBeenCalledTimes(1);

    now += 2000;
    expect((await service.forDate('2026-10-20')).source).toBe('open-meteo');
    expect(fetchForecast).toHaveBeenCalledTimes(2);
  });

  it('treats a malformed response as a failure', async () => {
    fetchForecast.mockResolvedValueOnce({ error: true, reason: 'bad request' });
    expect((await service.forDate('2026-10-20')).source).toBe('fallback');
    expect(warn.mock.calls[0][0]).toMatch(/Weather fetch failed/);
  });

  it('keeps serving a stale entry when a refresh fails', async () => {
    await service.forDate('2026-10-20');
    now += WEATHER_CACHE_TTL_MS + MIN;
    fetchForecast.mockRejectedValueOnce(new Error('timeout'));
    expect((await service.forDate('2026-10-20')).source).toBe('open-meteo');
    expect(fetchForecast).toHaveBeenCalledTimes(2);
  });

  describe('irradianceForInterval', () => {
    it('interpolates the hour means to the middle of the interval', async () => {
      // Interval 12:00–12:05 local (midpoint 12:02:30). Hour means: 716 W/m² for
      // 11–12 (centre 11:30) and 877 W/m² for 12–13 (centre 12:30).
      const wm2 = await service.irradianceForInterval(
        new Date('2026-10-20T01:00:00.000Z'),
        5,
      );
      expect(wm2).toBeCloseTo(716 + ((877 - 716) * 32.5) / 60, 6);
    });

    it('is 0 at night', async () => {
      // 02:00 local on 20 October.
      expect(
        await service.irradianceForInterval(
          new Date('2026-10-19T15:00:00.000Z'),
          5,
        ),
      ).toBe(0);
    });

    it('returns null (use the fallback) outside the data', async () => {
      expect(
        await service.irradianceForInterval(
          new Date('2026-12-01T01:00:00.000Z'),
          5,
        ),
      ).toBeNull();
    });
  });
});
