import { localDayRange } from '../common/local-time';
import { SITE } from '../common/site';
import type { WeatherForDate } from './weather.service';

/** Response of `GET /api/weather?date=YYYY-MM-DD` (Melbourne local date). */
export type WeatherDayView = {
  date: string;
  location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  source: 'open-meteo' | 'fallback';
  sunrise: string | null; // ISO, UTC
  sunset: string | null;
  daylightHours: number | null;
  sunshineHours: number | null;
  /** Hour means: irradiance and cloud cover averaged over [start, end). */
  hourly: {
    start: string;
    end: string;
    irradianceWm2: number;
    cloudCoverPct: number;
  }[];
};

const HOUR_MS = 3_600_000;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Shapes the cached weather for one local date. Pure. */
export function toWeatherDayView(
  date: string,
  weather: WeatherForDate,
): WeatherDayView {
  const base = {
    date,
    location: {
      name: SITE.name,
      latitude: SITE.latitude,
      longitude: SITE.longitude,
      timezone: SITE.timeZone,
    },
  };
  if (weather.source === 'fallback') {
    return {
      ...base,
      source: 'fallback',
      sunrise: null,
      sunset: null,
      daylightHours: null,
      sunshineHours: null,
      hourly: [],
    };
  }

  // Hours whose averaging window starts within this local day (23, 24 or 25).
  const { start, end } = localDayRange(date, SITE.timeZone);
  const hourly = weather.forecast.hourly
    .filter((h) => {
      const from = h.endsAt - HOUR_MS;
      return from >= start.getTime() && from < end.getTime();
    })
    .map((h) => ({
      start: new Date(h.endsAt - HOUR_MS).toISOString(),
      end: new Date(h.endsAt).toISOString(),
      irradianceWm2: h.irradianceWm2,
      cloudCoverPct: h.cloudCoverPct,
    }));

  return {
    ...base,
    source: 'open-meteo',
    sunrise: new Date(weather.day.sunrise).toISOString(),
    sunset: new Date(weather.day.sunset).toISOString(),
    daylightHours: round1(weather.day.daylightSeconds / 3600),
    sunshineHours: round1(weather.day.sunshineSeconds / 3600),
    hourly,
  };
}
