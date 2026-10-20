/**
 * Solar and demand profiles for the simulator (SPEC.md §6.2). Pure: no framework
 * imports, no clock, no randomness of their own. Random draws and weather are
 * passed in. Hours are the site's local hours (ADR-008).
 */
import { MAX_DEMAND_WH } from '../common/limits';
import { mulberry32 } from './prng';

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

/** An instantaneous reading at time `at` (ms), e.g. hourly temperature_2m. */
export type TimedValue = { at: number; value: number };

/**
 * Value at instant `t`, interpolated linearly between instantaneous samples
 * (not hour means: no half-hour offset). Sorted by `at`; null outside the range.
 */
export function valueAt(series: TimedValue[], t: number): number | null {
  for (let i = 0; i < series.length; i++) {
    const p = series[i];
    if (t === p.at) return p.value;
    if (t < p.at) {
      if (i === 0) return null;
      const q = series[i - 1];
      return q.value + ((p.value - q.value) * (t - q.at)) / (p.at - q.at);
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

/* ------------------------------------------------------------------------- *
 * Demand (ADR-009). Illustrative, not measured: a typical residential shape  *
 * scaled to a per-household daily target, made different per flat and per   *
 * day by seeded draws. Each interval is a pure function of (seed, flat,      *
 * local date, interval of the day), so re-runs give identical values.        *
 * ------------------------------------------------------------------------- */

/** People per flat, by lot entitlement (bigger lots, bigger households). */
export const PERSONS_BY_ENTITLEMENT: Readonly<Record<number, number>> = {
  10: 1,
  15: 2,
  20: 2,
  30: 3,
};

/**
 * Daily energy target by household size, in kWh. The demo building averages
 * 9.5 kWh per flat; CitiPower reports 9.9 kWh/day for units in 2025 (benchmark).
 */
export const DAILY_KWH_BY_PERSONS: Readonly<Record<number, number>> = {
  1: 7,
  2: 10,
  3: 13,
};

/** Household size for any entitlement; unmapped values use the nearest band. */
export function householdSize(lotEntitlement: number): number {
  return (
    PERSONS_BY_ENTITLEMENT[lotEntitlement] ??
    (lotEntitlement < 15 ? 1 : lotEntitlement < 30 ? 2 : 3)
  );
}

export function dailyTargetKwh(lotEntitlement: number): number {
  return DAILY_KWH_BY_PERSONS[householdSize(lotEntitlement)];
}

const normalise = (raw: number[]) => {
  const total = raw.reduce((s, x) => s + x, 0);
  return Object.freeze(raw.map((x) => x / total));
};

/**
 * Illustrative typical residential load shapes, NOT measured data: the share of
 * a day's energy used in each local hour (index 0 = 00:00–01:00), summing to 1.
 * Weekday: low overnight (fridge and standby), a morning peak around
 * 06:30–08:30, low daytime use, an evening peak around 17:30–21:30.
 */
export const WEEKDAY_LOAD_SHAPE = normalise([
  0.022, 0.021, 0.02, 0.02, 0.021, 0.026, 0.045, 0.068, 0.058, 0.034, 0.026,
  0.025, 0.026, 0.025, 0.025, 0.028, 0.036, 0.055, 0.074, 0.083, 0.079, 0.066,
  0.048, 0.032,
]);

/** Weekend: a later, smaller morning peak and more daytime use. Illustrative. */
export const WEEKEND_LOAD_SHAPE = normalise([
  0.023, 0.022, 0.021, 0.02, 0.02, 0.022, 0.028, 0.04, 0.055, 0.062, 0.052,
  0.045, 0.044, 0.042, 0.041, 0.042, 0.045, 0.056, 0.068, 0.074, 0.07, 0.058,
  0.046, 0.033,
]);

/**
 * Share of the day's energy per hour at local `hour`, interpolated linearly
 * between hour centres (hh:30) and wrapping round midnight, so there is no step
 * at the hour and the day's integral still equals 1.
 */
export function loadShapeAt(hour: number, weekend: boolean): number {
  const shape = weekend ? WEEKEND_LOAD_SHAPE : WEEKDAY_LOAD_SHAPE;
  const x = (((hour - 0.5) % 24) + 24) % 24; // hours past the 00:30 centre
  const i = Math.floor(x);
  const f = x - i;
  return shape[i] * (1 - f) + shape[(i + 1) % 24] * f;
}

/** A flat's routine is shifted by up to this many minutes either way. */
export const ROUTINE_SHIFT_MINUTES = 45;
/** Daily multiplier range per (flat, date). */
export const DAILY_MULTIPLIER = { min: 0.85, max: 1.15 } as const;
/** Mean-reverting noise: stationary spread and per-interval persistence. */
const NOISE_SD = 0.08;
const NOISE_PERSISTENCE = 0.92;
const NOISE_STEP_SD = NOISE_SD * Math.sqrt(1 - NOISE_PERSISTENCE ** 2);
const NOISE_LIMIT = 0.4;
/** Appliance events (kettle, oven, washing machine) in waking hours. */
export const APPLIANCE_EVENT = {
  probability: 0.006, // per waking interval, when no event is running
  minWh: 40,
  maxWh: 150, // per interval while it runs
  minIntervals: 1,
  maxIntervals: 4,
  wakingFrom: 6.5, // local hours
  wakingTo: 22.5,
} as const;
/** Heating below / cooling above these temperatures, in waking hours only. */
export const HVAC = {
  heatingBelowC: 16,
  coolingAboveC: 26,
  heatingWPerDegree: 40,
  coolingWPerDegree: 60,
  capW: 600,
  fromHour: 6,
  toHour: 23,
} as const;

/** FNV-1a: a stable 32-bit seed from labelled parts, for mulberry32 streams. */
function streamSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A uniform draw rescaled to mean 0, variance 1. */
const unit = (r: number) => (r - 0.5) * Math.sqrt(12);

/** One flat's random streams for one local day, from seeded draws only. */
type DayStreams = {
  /** Smooth noise per interval, mean 0 over the day. */
  noise: number[];
  /** Appliance-event Wh per interval. */
  events: number[];
  /** Total appliance-event Wh over the nominal 24 h. */
  eventWhTotal: number;
};

const dayStreamsCache = new Map<string, DayStreams>();
const DAY_STREAMS_CACHE_SIZE = 64;

/**
 * Generates a flat's noise and appliance events for a whole local day (25 h of
 * intervals, enough for a daylight-saving day). The noise is a mean-reverting
 * AR(1) walk with its daily mean removed, so it reshapes the day without
 * changing its total. Memoised; the result depends only on the arguments.
 */
function dayStreams(
  seed: number,
  flatIndex: number,
  localDate: string,
  intervalMinutes: number,
): DayStreams {
  const key = `${seed}|${flatIndex}|${localDate}|${intervalMinutes}`;
  const cached = dayStreamsCache.get(key);
  if (cached) return cached;

  const length = (25 * 60) / intervalMinutes;
  const nominal = (24 * 60) / intervalMinutes;

  const noiseRng = mulberry32(streamSeed(seed, flatIndex, localDate, 'noise'));
  const walk: number[] = [];
  let x = NOISE_SD * unit(noiseRng());
  for (let k = 0; k < length; k++) {
    if (k > 0) x = NOISE_PERSISTENCE * x + NOISE_STEP_SD * unit(noiseRng());
    walk.push(x);
  }
  const mean = walk.slice(0, nominal).reduce((s, v) => s + v, 0) / nominal;
  const noise = walk.map((v) => clamp(v - mean, -NOISE_LIMIT, NOISE_LIMIT));

  const e = APPLIANCE_EVENT;
  const eventRng = mulberry32(streamSeed(seed, flatIndex, localDate, 'events'));
  const events: number[] = [];
  let left = 0;
  let amount = 0;
  for (let k = 0; k < length; k++) {
    const r = eventRng();
    const nominalHour = (k * intervalMinutes) / 60;
    if (
      left === 0 &&
      nominalHour >= e.wakingFrom &&
      nominalHour < e.wakingTo &&
      r < e.probability
    ) {
      left =
        e.minIntervals +
        Math.floor(eventRng() * (e.maxIntervals - e.minIntervals + 1));
      amount = e.minWh + Math.round(eventRng() * (e.maxWh - e.minWh));
    }
    events.push(left > 0 ? amount : 0);
    if (left > 0) left--;
  }
  const eventWhTotal = events.slice(0, nominal).reduce((s, v) => s + v, 0);

  const streams = { noise, events, eventWhTotal };
  if (dayStreamsCache.size >= DAY_STREAMS_CACHE_SIZE) {
    dayStreamsCache.delete(dayStreamsCache.keys().next().value!);
  }
  dayStreamsCache.set(key, streams);
  return streams;
}

/** Heating or cooling power in W for a temperature, 0 without one. */
function hvacW(temperatureC: number | null, localHour: number): number {
  if (temperatureC === null) return 0;
  if (localHour < HVAC.fromHour || localHour >= HVAC.toHour) return 0;
  const w =
    temperatureC < HVAC.heatingBelowC
      ? (HVAC.heatingBelowC - temperatureC) * HVAC.heatingWPerDegree
      : temperatureC > HVAC.coolingAboveC
        ? (temperatureC - HVAC.coolingAboveC) * HVAC.coolingWPerDegree
        : 0;
  return Math.min(w, HVAC.capW);
}

export type DemandInput = {
  seed: number;
  /** Position of the flat in label order (Unit 1 = 0). */
  flatIndex: number;
  lotEntitlement: number;
  /** Melbourne local date of the interval, YYYY-MM-DD. */
  localDate: string;
  /** Intervals since local midnight (0 … 275 / 287 / 299). */
  intervalOfDay: number;
  /** Local fractional hour at the interval's midpoint. */
  localHour: number;
  /** Outdoor temperature for the interval, or null (no heating/cooling). */
  temperatureC: number | null;
  intervalMinutes: number;
};

/**
 * One flat's demand for one interval, in whole Wh in [0, MAX_DEMAND_WH]:
 * daily target × shared load shape (shifted per flat) × daily multiplier ×
 * smooth noise, plus appliance events and weather-linked heating/cooling.
 * Depends only on its inputs, never on earlier readings.
 */
export function intervalDemandWh(input: DemandInput): number {
  const { seed, flatIndex, localDate, intervalOfDay, intervalMinutes } = input;
  const weekend = [0, 6].includes(
    new Date(`${localDate}T12:00:00Z`).getUTCDay(),
  );

  const shiftHours =
    ((mulberry32(streamSeed(seed, flatIndex, 'shift'))() * 2 - 1) *
      ROUTINE_SHIFT_MINUTES) /
    60;
  const dayMultiplier =
    DAILY_MULTIPLIER.min +
    (DAILY_MULTIPLIER.max - DAILY_MULTIPLIER.min) *
      mulberry32(streamSeed(seed, flatIndex, localDate, 'day'))();
  const streams = dayStreams(seed, flatIndex, localDate, intervalMinutes);

  // The day's budget is target × multiplier; appliance events come out of it,
  // and the noise (mean 0 over the day) only moves energy around within it.
  const dayBudgetWh =
    dailyTargetKwh(input.lotEntitlement) * 1000 * dayMultiplier;
  const shapeBudgetWh = Math.max(0, dayBudgetWh - streams.eventWhTotal);
  const shapeWh =
    shapeBudgetWh *
    loadShapeAt(input.localHour - shiftHours, weekend) *
    (intervalMinutes / 60);
  const hvacWh =
    (hvacW(input.temperatureC, input.localHour) * intervalMinutes) / 60;

  const wh =
    shapeWh * (1 + (streams.noise[intervalOfDay] ?? 0)) +
    (streams.events[intervalOfDay] ?? 0) +
    hvacWh;
  return clamp(Math.round(wh), 0, MAX_DEMAND_WH);
}
