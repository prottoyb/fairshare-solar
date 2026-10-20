/**
 * Solar and demand profiles for the simulator (SPEC.md §6.2). Pure: no framework
 * imports, no clock, no randomness of their own. Random draws and weather are
 * passed in. Hours are the site's local hours (ADR-008).
 */
import { MAX_DEMAND_WH } from '../common/limits';

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/** Clear-sky shape: 0 at night, a sine arch from 06:00 to 18:00 peaking at 1. */
export function clearSky(hour: number): number {
  return hour >= 6 && hour <= 18 ? Math.sin((Math.PI * (hour - 6)) / 12) : 0;
}

/** Cloud factor random walk in [0.6, 1]; start from 1. `r` is a draw in [0, 1). */
export function nextCloud(prevCloud: number, r: number): number {
  return 0.7 * prevCloud + 0.3 * (0.6 + 0.4 * r);
}

/** The most a building can generate in one interval, in Wh. */
export function maxSolarWh(capacityW: number, intervalMinutes: number): number {
  return Math.floor((capacityW * intervalMinutes) / 60);
}

/** Solar energy for one interval starting at `hour`, in whole Wh. */
export function solarWh(
  capacityW: number,
  hour: number,
  cloud: number,
  intervalMinutes: number,
): number {
  const wh = Math.round(
    (capacityW * clearSky(hour) * cloud * intervalMinutes) / 60,
  );
  return clamp(wh, 0, maxSolarWh(capacityW, intervalMinutes));
}

/**
 * Share of the panels' rated output that reaches the building after inverter,
 * wiring, temperature and soiling losses. 0.8 is a typical rooftop value (ADR-008).
 */
export const PERFORMANCE_RATIO = 0.8;

/**
 * Solar energy for one interval from measured/forecast irradiance (W/m² on a
 * horizontal surface): capacity × irradiance / 1000 × PR × minutes / 60, whole Wh,
 * clamped to [0, the interval cap]. Irradiance already includes cloud.
 */
export function solarWhFromIrradiance(
  capacityW: number,
  irradianceWm2: number,
  intervalMinutes: number,
): number {
  const wh = Math.round(
    (((capacityW * irradianceWm2) / 1000) *
      PERFORMANCE_RATIO *
      intervalMinutes) /
      60,
  );
  return clamp(wh, 0, maxSolarWh(capacityW, intervalMinutes));
}

/** One hourly value: the mean irradiance over the hour that ends at `endsAt` (ms). */
export type HourlyIrradiance = { endsAt: number; wm2: number };

const HOUR_MS = 3_600_000;

/**
 * Irradiance at instant `at` (ms), interpolated linearly between hour means placed
 * at the centre of their hour (half past the previous hour). `series` must be sorted
 * by `endsAt`. Null outside the series' range.
 */
export function irradianceAt(
  series: HourlyIrradiance[],
  at: number,
): number | null {
  const centre = (p: HourlyIrradiance) => p.endsAt - HOUR_MS / 2;
  for (let i = 0; i < series.length; i++) {
    const c = centre(series[i]);
    if (at === c) return series[i].wm2;
    if (at < c) {
      if (i === 0) return null;
      const prev = series[i - 1];
      const c0 = centre(prev);
      return prev.wm2 + ((series[i].wm2 - prev.wm2) * (at - c0)) / (c - c0);
    }
  }
  return null;
}

/** Irradiance for the interval starting at `start`, sampled at its midpoint. */
export function intervalIrradiance(
  series: HourlyIrradiance[],
  start: Date,
  intervalMinutes: number,
): number | null {
  return irradianceAt(series, start.getTime() + (intervalMinutes * 60_000) / 2);
}

/** An apartment's fixed base load, 40–80 Wh per interval. */
export function baseDemandWh(r: number): number {
  return 40 + Math.round(40 * r);
}

/** A half-sine bump between `start` and `end` hours, `peak` Wh at its middle. */
function bump(hour: number, start: number, end: number, peak: number): number {
  return hour >= start && hour <= end
    ? peak * Math.sin((Math.PI * (hour - start)) / (end - start))
    : 0;
}

/**
 * One apartment's demand for one interval: base load plus a morning bump
 * (06–09, +150 Wh peak) and an evening bump (17–22, +300 Wh peak), with ±20 %
 * noise from `r`. Clamped to [0, MAX_DEMAND_WH] and rounded.
 */
export function demandWh(baseWh: number, hour: number, r: number): number {
  const expected = baseWh + bump(hour, 6, 9, 150) + bump(hour, 17, 22, 300);
  const noise = 0.8 + 0.4 * r; // 0.8 … 1.2
  return clamp(Math.round(expected * noise), 0, MAX_DEMAND_WH);
}
