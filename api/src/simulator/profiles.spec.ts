import { isAlignedToInterval } from '../common/time';
import { mulberry32 } from './prng';
import {
  baseDemandWh,
  clearSky,
  demandWh,
  maxSolarWh,
  nextCloud,
  solarWh,
} from './profiles';
import { ReadingGenerator } from './reading-generator';

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

describe('demand profile', () => {
  it('draws a base load of 40–80 Wh', () => {
    expect(baseDemandWh(0)).toBe(40);
    expect(baseDemandWh(0.999)).toBe(80);
  });

  it('stays an integer in [0, 10000] at every hour and noise extreme', () => {
    for (let h = 0; h < 24; h += 5 / 60) {
      for (const base of [40, 80]) {
        for (const r of [0, 0.5, 0.999]) {
          const wh = demandWh(base, h, r);
          expect(Number.isInteger(wh)).toBe(true);
          expect(wh).toBeGreaterThanOrEqual(0);
          expect(wh).toBeLessThanOrEqual(10_000);
        }
      }
    }
  });

  it('has morning and evening bumps, the evening one larger', () => {
    const night = demandWh(60, 3, 0.5);
    const morning = demandWh(60, 7.5, 0.5);
    const evening = demandWh(60, 19.5, 0.5);
    expect(night).toBe(60);
    expect(morning).toBe(60 + 150);
    expect(evening).toBe(60 + 300);
  });

  it('applies ±20 % noise', () => {
    expect(demandWh(100, 3, 0)).toBe(80);
    expect(demandWh(100, 3, 0.5)).toBe(100);
    expect(demandWh(100, 3, 0.9999)).toBe(120);
  });
});

describe('ReadingGenerator', () => {
  const apartments = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const day = Array.from(
    { length: 288 },
    (_, i) => new Date(Date.UTC(2026, 9, 20, 0, i * 5)),
  );

  function runDay(seed: number) {
    const gen = new ReadingGenerator(seed, apartments, CAPACITY_W, 'dev-1');
    return day.map((t) => gen.next(t));
  }

  it('gives the same sequence for the same seed', () => {
    expect(runDay(42)).toEqual(runDay(42));
  });

  it('gives a different sequence for a different seed', () => {
    expect(runDay(42)).not.toEqual(runDay(43));
  });

  it('produces readings that pass ingest validation', () => {
    for (const r of runDay(42)) {
      expect(r.deviceId).toBe('dev-1');
      expect(isAlignedToInterval(new Date(r.intervalStart), 5)).toBe(true);
      expect(Number.isInteger(r.solarWh)).toBe(true);
      expect(r.solarWh).toBeGreaterThanOrEqual(0);
      expect(r.solarWh).toBeLessThanOrEqual(CAP_WH);
      expect(r.demands.map((d) => d.apartmentId)).toEqual(apartments);
      for (const d of r.demands) {
        expect(Number.isInteger(d.demandWh)).toBe(true);
        expect(d.demandWh).toBeGreaterThanOrEqual(0);
        expect(d.demandWh).toBeLessThanOrEqual(10_000);
      }
    }
  });

  it('makes a plausible day: dark at night, generating around noon', () => {
    const readings = runDay(42);
    const at = (h: number) => readings[h * 12];
    expect(at(2).solarWh).toBe(0);
    expect(at(22).solarWh).toBe(0);
    expect(at(12).solarWh).toBeGreaterThan(CAP_WH * 0.6 - 1);
  });
});
