import { Injectable } from '@nestjs/common';
import { OPEN_METEO_URL } from './open-meteo';

/** Where raw forecast JSON comes from. Tests replace it with a fake (no network). */
export interface WeatherProvider {
  fetchForecast(): Promise<unknown>;
}

export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');

/** Wall clock for cache freshness; injectable so tests can move time. */
export const WEATHER_CLOCK = Symbol('WEATHER_CLOCK');
export type WeatherClock = () => number;

const FETCH_TIMEOUT_MS = 10_000;

/** The real provider: Open-Meteo over Node's built-in fetch, no API key. */
@Injectable()
export class OpenMeteoProvider implements WeatherProvider {
  async fetchForecast(): Promise<unknown> {
    const res = await fetch(OPEN_METEO_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Open-Meteo returned HTTP ${res.status}`);
    }
    return (await res.json()) as unknown;
  }
}
