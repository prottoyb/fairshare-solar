/**
 * Solar and demand profiles for the simulator (brief §6.2). Pure: no framework
 * imports, no clock, no randomness of their own. Random draws are passed in.
 * The UTC hour is treated as "local" time for the demo.
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
