import { localDayRange } from '../common/local-time';
import { isAlignedToInterval } from '../common/time';
import { loadOpenMeteoFixture } from '../weather/__fixtures__/load-fixture';
import { parseOpenMeteo } from '../weather/open-meteo';
import { mulberry32 } from './prng';
import {
  clearSky,
  intervalIrradiance,
  maxSolarWh,
  nextCloud,
  solarWh,
  solarWhFromIrradiance,
  valueAt,
} from './profiles';
import { GeneratorWeather, ReadingGenerator } from './reading-generator';

// The demand model has its own tests in demand.spec.ts.

const CAPACITY_W = 30000;
const CAP_WH = (CAPACITY_W * 5) / 60; // capacity × one 5-minute interval

describe('solar profile', () => {
  it.each([0, 3, 5.99, 18.01, 21, 23.92])(
    'is 0 at night (hour %s), even with no cloud',
    (hour) => {
      expect(solarWh(CAPACITY_W, hour, 1, 5)).toBe(0);
    },
  );

  it('peaks at noon and never exceeds the interval cap', () => {
    expect(clearSky(12)).toBe(1);
    expect(solarWh(CAPACITY_W, 12, 1, 5)).toBe(CAP_WH);
    expect(maxSolarWh(CAPACITY_W, 5)).toBe(CAP_WH);
    for (let h = 0; h < 24; h += 5 / 60) {
      for (const cloud of [0.6, 0.8, 1]) {
        const wh = solarWh(CAPACITY_W, h, cloud, 5);
        expect(Number.isInteger(wh)).toBe(true);
        expect(wh).toBeGreaterThanOrEqual(0);
        expect(wh).toBeLessThanOrEqual(CAP_WH);
      }
    }
  });

  it('is symmetric around noon', () => {
    expect(clearSky(9)).toBeCloseTo(clearSky(15), 12);
  });

  it('keeps the cloud factor within [0.6, 1] starting from 1', () => {
    const rng = mulberry32(42);
    let cloud = 1;
    for (let i = 0; i < 10_000; i++) {
      cloud = nextCloud(cloud, rng());
      expect(cloud).toBeGreaterThanOrEqual(0.6);
      expect(cloud).toBeLessThanOrEqual(1);
    }
    expect(nextCloud(1, 0)).toBeCloseTo(0.88, 12);
  });
});

describe('valueAt (instantaneous samples, e.g. temperature)', () => {
  const s = [
    { at: 0, value: 10 },
    { at: 3_600_000, value: 14 },
  ];

  it('interpolates linearly between the stamped times, with no offset', () => {
    expect(valueAt(s, 0)).toBe(10);
    expect(valueAt(s, 1_800_000)).toBe(12);
    expect(valueAt(s, 3_600_000)).toBe(14);
  });

  it('returns null outside the samples', () => {
    expect(valueAt(s, -1)).toBeNull();
    expect(valueAt(s, 3_600_001)).toBeNull();
    expect(valueAt([], 0)).toBeNull();
  });
});

describe('ReadingGenerator', () => {
  const MEL = 'Australia/Melbourne';
  const apartments = [10, 10, 15, 15, 20, 30].map((lotEntitlement, i) => ({
    id: `a${i + 1}`,
    lotEntitlement,
  }));
  // One Melbourne local day (20 October 2026), 288 intervals from local midnight.
  const { start } = localDayRange('2026-10-20', MEL);
  const day = Array.from(
    { length: 288 },
    (_, i) => new Date(start.getTime() + i * 5 * 60_000),
  );
  // Real weather for that day from the saved Open-Meteo response.
  const hourly = parseOpenMeteo(loadOpenMeteoFixture(), MEL).hourly;
  const series = hourly.map((h) => ({
    endsAt: h.endsAt,
    wm2: h.irradianceWm2,
  }));
  const temps = hourly.map((h) => ({ at: h.endsAt, value: h.temperatureC! }));
  const solarOnly = (t: Date): GeneratorWeather => ({
    irradianceWm2: intervalIrradiance(series, t, 5),
    temperatureC: null,
  });
  const realWeather = (t: Date): GeneratorWeather => ({
    irradianceWm2: intervalIrradiance(series, t, 5),
    temperatureC: valueAt(temps, t.getTime() + 150_000),
  });
  const noWeather = (): GeneratorWeather => ({
    irradianceWm2: null,
    temperatureC: null,
  });

  function runDay(
    seed: number,
    weather: (t: Date) => GeneratorWeather = noWeather,
  ) {
    const gen = new ReadingGenerator(
      seed,
      apartments,
      CAPACITY_W,
      'dev-1',
      MEL,
    );
    return day.map((t) => gen.next(t, weather(t)));
  }

  it('gives the same sequence for the same seed and weather', () => {
    expect(runDay(42, realWeather)).toEqual(runDay(42, realWeather));
  });

  it('takes solar from the irradiance input', () => {
    const gen = new ReadingGenerator(42, apartments, CAPACITY_W, 'dev-1', MEL);
    expect(
      gen.next(day[144], { irradianceWm2: 1000, temperatureC: null }).solarWh,
    ).toBe(solarWhFromIrradiance(CAPACITY_W, 1000, 5));
    expect(
      gen.next(day[145], { irradianceWm2: 0, temperatureC: null }).solarWh,
    ).toBe(0);
  });

  it('simulates the same demand whether or not solar weather is available', () => {
    const withSolar = runDay(42, solarOnly).map((r) => r.demands);
    const fallback = runDay(42).map((r) => r.demands);
    expect(withSolar).toEqual(fallback);
  });

  it('adds heating/cooling demand from the temperature input', () => {
    // 20 October reached about 27 °C in the afternoon (above 26 °C: cooling).
    const kwh = (rs: ReturnType<typeof runDay>) =>
      rs.flatMap((r) => r.demands).reduce((s, d) => s + d.demandWh, 0);
    expect(kwh(runDay(42, realWeather))).toBeGreaterThan(kwh(runDay(42)));
  });

  it('gives an interval the same demand whatever came before (restart-safe)', () => {
    const fullDay = runDay(42);
    const fresh = new ReadingGenerator(
      42,
      apartments,
      CAPACITY_W,
      'dev-1',
      MEL,
    );
    expect(fresh.next(day[200], noWeather()).demands).toEqual(
      fullDay[200].demands,
    );
  });

  it('puts the evening peak in the local evening', () => {
    const readings = runDay(42);
    const total = (h: number) =>
      readings[h * 12].demands.reduce((s, d) => s + d.demandWh, 0);
    expect(total(19.5)).toBeGreaterThan(total(3) * 2); // 19:30 vs 03:00 local
  });

  it('follows the real weather: dark at night, generating at midday', () => {
    const readings = runDay(42, realWeather);
    const at = (h: number) => readings[h * 12];
    expect(at(2).solarWh).toBe(0); // 02:00 local
    expect(at(22).solarWh).toBe(0); // 22:00 local
    // 12:00–12:05 local: about 803 W/m² (see the WeatherService test).
    expect(at(12).solarWh).toBe(
      solarWhFromIrradiance(
        CAPACITY_W,
        realWeather(day[144]).irradianceWm2!,
        5,
      ),
    );
    expect(at(12).solarWh).toBeGreaterThan(0);
  });

  it('gives a different sequence for a different seed', () => {
    expect(runDay(42)).not.toEqual(runDay(43));
  });

  it('produces readings that pass ingest validation', () => {
    for (const r of runDay(42, realWeather)) {
      expect(r.deviceId).toBe('dev-1');
      expect(isAlignedToInterval(new Date(r.intervalStart), 5)).toBe(true);
      expect(Number.isInteger(r.solarWh)).toBe(true);
      expect(r.solarWh).toBeGreaterThanOrEqual(0);
      expect(r.solarWh).toBeLessThanOrEqual(CAP_WH);
      expect(r.demands.map((d) => d.apartmentId)).toEqual(
        apartments.map((a) => a.id),
      );
      for (const d of r.demands) {
        expect(Number.isInteger(d.demandWh)).toBe(true);
        expect(d.demandWh).toBeGreaterThanOrEqual(0);
        expect(d.demandWh).toBeLessThanOrEqual(10_000);
      }
    }
  });

  it('falls back to a plausible clear-sky day: dark at night, generating around noon', () => {
    const readings = runDay(42);
    const at = (h: number) => readings[h * 12];
    expect(at(2).solarWh).toBe(0);
    expect(at(22).solarWh).toBe(0);
    expect(at(12).solarWh).toBeGreaterThan(CAP_WH * 0.6 - 1);
  });
});
