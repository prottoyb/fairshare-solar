import { Inject, Injectable, Logger } from '@nestjs/common';
import { localDateString } from '../common/local-time';
import { SITE } from '../common/site';
import {
  HourlyIrradiance,
  intervalIrradiance,
  TimedValue,
  valueAt,
} from '../simulator/profiles';
import { DailyWeather, Forecast, parseOpenMeteo } from './open-meteo';
import {
  WEATHER_CLOCK,
  WEATHER_PROVIDER,
  type WeatherClock,
  type WeatherProvider,
} from './weather.provider';

/** Today and future dates are refetched after this long; past dates never. */
export const WEATHER_CACHE_TTL_MS = 60 * 60_000;
/** After a failed fetch, wait this long before trying again. */
export const WEATHER_RETRY_AFTER_MS = 60_000;

export type WeatherForDate =
  | { source: 'open-meteo'; forecast: Forecast; day: DailyWeather }
  | { source: 'fallback' };

type CacheEntry = {
  forecast: Forecast;
  series: HourlyIrradiance[];
  temperatures: TimedValue[];
  fetchedAt: number;
};

/** Weather for one interval; null fields mean "use the fallback / add nothing". */
export type IntervalWeather = {
  irradianceWm2: number | null;
  temperatureC: number | null;
};

/**
 * Real weather for the site, cached per local date in memory (ADR-008). One
 * response covers 9 days, so a fetch fills several dates. If the source fails or
 * a date is out of range it logs a warning (once per date) and returns
 * `fallback`; callers then use the clear-sky curve, so the simulator never stops.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly warned = new Set<string>();
  private lastAttemptAt: number | null = null;
  private lastAttemptFailed = false;
  private inflight: Promise<void> | null = null;

  constructor(
    @Inject(WEATHER_PROVIDER) private readonly provider: WeatherProvider,
    @Inject(WEATHER_CLOCK) private readonly now: WeatherClock,
  ) {}

  /** Weather for a local `YYYY-MM-DD` date, or `fallback`. */
  async forDate(date: string): Promise<WeatherForDate> {
    const entry = await this.entryFor(date);
    if (!entry) {
      this.warnOnce(
        date,
        `No weather data for ${date}; using the clear-sky curve`,
      );
      return { source: 'fallback' };
    }
    return {
      source: 'open-meteo',
      forecast: entry.forecast,
      day: entry.forecast.days.get(date)!,
    };
  }

  /**
   * Irradiance (W/m²) for the interval starting at `start`, or null when the
   * caller should use the clear-sky fallback.
   */
  async irradianceForInterval(
    start: Date,
    intervalMinutes: number,
  ): Promise<number | null> {
    const date = localDateString(start, SITE.timeZone);
    const entry = await this.entryFor(date);
    const wm2 = entry
      ? intervalIrradiance(entry.series, start, intervalMinutes)
      : null;
    if (wm2 === null) {
      this.warnOnce(
        date,
        `No weather data for ${date}; using the clear-sky curve`,
      );
    }
    return wm2;
  }

  /**
   * Irradiance and outdoor temperature for the interval starting at `start`,
   * both sampled at its midpoint (ADR-008, ADR-009). Nulls in fallback.
   */
  async intervalWeather(
    start: Date,
    intervalMinutes: number,
  ): Promise<IntervalWeather> {
    const irradianceWm2 = await this.irradianceForInterval(
      start,
      intervalMinutes,
    );
    const entry = this.cache.get(localDateString(start, SITE.timeZone));
    const midpoint = start.getTime() + (intervalMinutes * 60_000) / 2;
    const temperatureC =
      irradianceWm2 !== null && entry
        ? valueAt(entry.temperatures, midpoint)
        : null;
    return { irradianceWm2, temperatureC };
  }

  private async entryFor(date: string): Promise<CacheEntry | undefined> {
    const entry = this.cache.get(date);
    if (entry && this.isFresh(date, entry)) return entry;
    // Join a fetch already in flight before judging whether a new one is allowed.
    if (this.inflight) await this.inflight;
    else if (this.canFetch()) await this.refresh();
    // A stale entry is still better than the fallback if a refresh failed.
    return this.cache.get(date);
  }

  private today(): string {
    return localDateString(new Date(this.now()), SITE.timeZone);
  }

  private isFresh(date: string, entry: CacheEntry): boolean {
    return (
      date < this.today() || this.now() - entry.fetchedAt < WEATHER_CACHE_TTL_MS
    );
  }

  private canFetch(): boolean {
    if (this.lastAttemptAt === null) return true;
    const wait = this.lastAttemptFailed
      ? WEATHER_RETRY_AFTER_MS
      : WEATHER_CACHE_TTL_MS;
    return this.now() - this.lastAttemptAt >= wait;
  }

  /** One fetch at a time; concurrent callers share it. */
  private refresh(): Promise<void> {
    this.inflight ??= this.fetchAndCache().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchAndCache(): Promise<void> {
    this.lastAttemptAt = this.now();
    try {
      const forecast = parseOpenMeteo(
        await this.provider.fetchForecast(),
        SITE.timeZone,
      );
      const series = forecast.hourly.map((h) => ({
        endsAt: h.endsAt,
        wm2: h.irradianceWm2,
      }));
      const temperatures = forecast.hourly.flatMap((h) =>
        h.temperatureC === null
          ? []
          : [{ at: h.endsAt, value: h.temperatureC }],
      );
      const fetchedAt = this.now();
      const today = this.today();
      for (const date of forecast.days.keys()) {
        // Past days are kept as first fetched ("forever"); others are replaced.
        if (date < today && this.cache.has(date)) continue;
        this.cache.set(date, { forecast, series, temperatures, fetchedAt });
      }
      this.lastAttemptFailed = false;
    } catch (err) {
      this.lastAttemptFailed = true;
      this.logger.warn(
        `Weather fetch failed (${(err as Error).message}); using the clear-sky curve, retrying in ${WEATHER_RETRY_AFTER_MS / 1000} s`,
      );
    }
  }

  private warnOnce(date: string, message: string): void {
    if (this.warned.has(date)) return;
    this.warned.add(date);
    this.logger.warn(message);
  }
}
