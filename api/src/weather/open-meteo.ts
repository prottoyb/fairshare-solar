/**
 * Open-Meteo forecast API: request URL and response parser. Pure: no framework
 * imports, no network (the provider does the fetch). See ADR-008.
 */
import { localDateString } from '../common/local-time';
import { SITE } from '../common/site';

export const OPEN_METEO_URL =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${SITE.latitude}&longitude=${SITE.longitude}` +
  '&hourly=shortwave_radiation,cloud_cover' +
  '&daily=sunrise,sunset,sunshine_duration,daylight_duration' +
  `&timezone=${encodeURIComponent(SITE.timeZone)}` +
  '&timeformat=unixtime&past_days=2&forecast_days=7';

/** One hour: means over the hour ending at `endsAt` (ms since epoch). */
export type HourlyWeather = {
  endsAt: number;
  irradianceWm2: number; // shortwave_radiation: mean of the preceding hour
  cloudCoverPct: number;
};

export type DailyWeather = {
  date: string; // local YYYY-MM-DD
  sunrise: number; // ms since epoch
  sunset: number;
  sunshineSeconds: number;
  daylightSeconds: number;
};

export type Forecast = {
  hourly: HourlyWeather[]; // sorted by endsAt
  days: Map<string, DailyWeather>;
};

type Raw = {
  timezone?: unknown;
  hourly?: {
    time?: unknown;
    shortwave_radiation?: unknown;
    cloud_cover?: unknown;
  };
  daily?: {
    time?: unknown;
    sunrise?: unknown;
    sunset?: unknown;
    sunshine_duration?: unknown;
    daylight_duration?: unknown;
  };
};

function numbers(value: unknown, field: string): (number | null)[] {
  if (!Array.isArray(value)) {
    throw new Error(`Open-Meteo response is missing ${field}`);
  }
  return value.map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null,
  );
}

/**
 * Parses a forecast requested with `timeformat=unixtime`. Throws on a malformed
 * response; skips individual hours or days with missing (null) values.
 */
export function parseOpenMeteo(json: unknown, timeZone: string): Forecast {
  const raw = (json ?? {}) as Raw;
  if (raw.timezone !== timeZone) {
    throw new Error(
      `Open-Meteo response is for time zone ${String(raw.timezone)}, expected ${timeZone}`,
    );
  }

  const hTime = numbers(raw.hourly?.time, 'hourly.time');
  const hRad = numbers(
    raw.hourly?.shortwave_radiation,
    'hourly.shortwave_radiation',
  );
  const hCloud = numbers(raw.hourly?.cloud_cover, 'hourly.cloud_cover');
  const hourly: HourlyWeather[] = [];
  hTime.forEach((t, i) => {
    const wm2 = hRad[i];
    const cloud = hCloud[i];
    if (t === null || wm2 === null || wm2 === undefined) return;
    hourly.push({
      endsAt: t * 1000,
      irradianceWm2: Math.max(0, wm2),
      cloudCoverPct: cloud ?? 0,
    });
  });
  hourly.sort((a, b) => a.endsAt - b.endsAt);

  const dTime = numbers(raw.daily?.time, 'daily.time');
  const sunrise = numbers(raw.daily?.sunrise, 'daily.sunrise');
  const sunset = numbers(raw.daily?.sunset, 'daily.sunset');
  const sunshine = numbers(
    raw.daily?.sunshine_duration,
    'daily.sunshine_duration',
  );
  const daylight = numbers(
    raw.daily?.daylight_duration,
    'daily.daylight_duration',
  );
  const days = new Map<string, DailyWeather>();
  dTime.forEach((t, i) => {
    const rise = sunrise[i];
    const set = sunset[i];
    if (t === null || rise === null || set === null) return;
    const date = localDateString(new Date(t * 1000), timeZone);
    days.set(date, {
      date,
      sunrise: rise * 1000,
      sunset: set * 1000,
      sunshineSeconds: sunshine[i] ?? 0,
      daylightSeconds: daylight[i] ?? 0,
    });
  });

  if (hourly.length === 0 || days.size === 0) {
    throw new Error('Open-Meteo response has no usable hourly or daily data');
  }
  return { hourly, days };
}
