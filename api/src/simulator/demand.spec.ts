import { localDayRange, localHourOfDay } from '../common/local-time';
import { MAX_DEMAND_WH } from '../common/limits';
import {
  dailyTargetKwh,
  DemandInput,
  householdSize,
  intervalDemandWh,
  loadShapeAt,
  WEEKDAY_LOAD_SHAPE,
  WEEKEND_LOAD_SHAPE,
} from './profiles';

const MEL = 'Australia/Melbourne';
const SEED = 42;
const ENTITLEMENTS = [10, 10, 15, 15, 20, 30]; // the demo building, Unit 1–6

/** Every 5-minute demand for one flat on one Melbourne local day. */
function flatDay(
  flatIndex: number,
  date: string,
  temperatureC: (at: Date) => number | null = () => null,
): number[] {
  const { start, end } = localDayRange(date, MEL);
  const out: number[] = [];
  for (let t = start.getTime(), k = 0; t < end.getTime(); t += 300_000, k++) {
    const at = new Date(t);
    const input: DemandInput = {
      seed: SEED,
      flatIndex,
      lotEntitlement: ENTITLEMENTS[flatIndex],
      localDate: date,
      intervalOfDay: k,
      localHour: localHourOfDay(new Date(t + 150_000), MEL),
      temperatureC: temperatureC(at),
      intervalMinutes: 5,
    };
    out.push(intervalDemandWh(input));
  }
  return out;
}

const kwh = (values: number[]) => values.reduce((s, x) => s + x, 0) / 1000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Two weeks of weekdays and weekends (Mon 19 Oct – Sun 1 Nov 2026), no weather.
const DATES = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 19 + i));
  return d.toISOString().slice(0, 10);
});

describe('household size and daily targets', () => {
  it('ties household size to lot size', () => {
    expect(ENTITLEMENTS.map(householdSize)).toEqual([1, 1, 2, 2, 2, 3]);
  });

  it('targets about 7 / 10 / 13 kWh a day for 1 / 2 / 3 people', () => {
    expect([10, 15, 20, 30].map(dailyTargetKwh)).toEqual([7, 10, 10, 13]);
  });

  it('averages about 10 kWh per flat across the building (CitiPower benchmark 9.9)', () => {
    const avg =
      ENTITLEMENTS.map(dailyTargetKwh).reduce((s, x) => s + x, 0) /
      ENTITLEMENTS.length;
    expect(avg).toBeCloseTo(9.5, 5);
  });
});

describe('load shape (illustrative, not measured)', () => {
  it('has 24 hourly fractions that sum to 1, for weekdays and weekends', () => {
    for (const shape of [WEEKDAY_LOAD_SHAPE, WEEKEND_LOAD_SHAPE]) {
      expect(shape).toHaveLength(24);
      expect(shape.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    }
  });

  it('peaks in the weekday morning (06:30–08:30) and evening (17:30–21:30)', () => {
    const at = (h: number) => loadShapeAt(h, false);
    expect(at(7.5)).toBeGreaterThan(at(3) * 2.5);
    expect(at(7.5)).toBeGreaterThan(at(12) * 2);
    expect(at(19.5)).toBeGreaterThan(at(7.5));
    expect(at(19.5)).toBeGreaterThan(at(3) * 3);
  });

  it('has a later, smaller morning peak and more daytime use at weekends', () => {
    expect(loadShapeAt(7.5, true)).toBeLessThan(loadShapeAt(7.5, false));
    expect(loadShapeAt(9.5, true)).toBeGreaterThan(loadShapeAt(9.5, false));
    expect(loadShapeAt(13, true)).toBeGreaterThan(loadShapeAt(13, false) * 1.4);
    expect(WEEKEND_LOAD_SHAPE).not.toEqual(WEEKDAY_LOAD_SHAPE);
  });

  it('is smooth across the hour: no step at hh:00', () => {
    for (let h = 1; h < 24; h++) {
      const before = loadShapeAt(h - 1 / 120, false);
      const after = loadShapeAt(h + 1 / 120, false);
      expect(Math.abs(after - before) / before).toBeLessThan(0.01);
    }
    // ...and across midnight.
    expect(loadShapeAt(23.999, false)).toBeCloseTo(
      loadShapeAt(0.001, false),
      3,
    );
  });
});

describe('intervalDemandWh', () => {
  it('keeps each flat within ±20 % of its daily target on every day', () => {
    for (const date of DATES) {
      ENTITLEMENTS.forEach((ent, i) => {
        const total = kwh(flatDay(i, date));
        expect(total).toBeGreaterThan(dailyTargetKwh(ent) * 0.8);
        expect(total).toBeLessThan(dailyTargetKwh(ent) * 1.2);
      });
    }
  });

  it('averages 8–12 kWh per flat per day across the building', () => {
    for (const date of DATES) {
      const avg =
        ENTITLEMENTS.map((_, i) => kwh(flatDay(i, date))).reduce(
          (s, x) => s + x,
          0,
        ) / ENTITLEMENTS.length;
      expect(avg).toBeGreaterThanOrEqual(8);
      expect(avg).toBeLessThanOrEqual(12);
    }
  });

  it('is smooth: median interval-to-interval change under 6 %', () => {
    const changes: number[] = [];
    for (const date of DATES.slice(0, 7)) {
      ENTITLEMENTS.forEach((_, i) => {
        const day = flatDay(i, date);
        for (let k = 1; k < day.length; k++) {
          changes.push(Math.abs(day[k] - day[k - 1]) / day[k - 1]);
        }
      });
    }
    expect(median(changes)).toBeLessThan(0.06);
  });

  it('differs from day to day for the same flat', () => {
    const totals = DATES.map((d) => kwh(flatDay(0, d)));
    expect(new Set(totals.map((t) => t.toFixed(2))).size).toBeGreaterThan(10);
    expect(kwh(flatDay(0, '2026-10-20'))).not.toBe(
      kwh(flatDay(0, '2026-10-21')),
    );
  });

  it('gives the same output for the same inputs, whatever was computed before', () => {
    const once = flatDay(3, '2026-10-21');
    flatDay(5, '2026-10-22'); // unrelated work in between
    expect(flatDay(3, '2026-10-21')).toEqual(once);
    // A single interval on its own equals the same interval in the full day.
    const k = 200;
    const single = intervalDemandWh({
      seed: SEED,
      flatIndex: 3,
      lotEntitlement: 15,
      localDate: '2026-10-21',
      intervalOfDay: k,
      localHour: localHourOfDay(
        new Date(
          localDayRange('2026-10-21', MEL).start.getTime() +
            k * 300_000 +
            150_000,
        ),
        MEL,
      ),
      temperatureC: null,
      intervalMinutes: 5,
    });
    expect(single).toBe(once[k]);
  });

  it('staggers the flats: their evening peaks fall at different times', () => {
    const peaks = ENTITLEMENTS.map((_, i) => {
      const day = flatDay(i, '2026-10-21');
      const evening = day.slice(17 * 12, 22 * 12);
      return evening.indexOf(Math.max(...evening));
    });
    expect(new Set(peaks).size).toBeGreaterThanOrEqual(4);
  });

  it('returns whole Wh within [0, MAX_DEMAND_WH], also on daylight-saving days', () => {
    for (const date of ['2026-10-04', '2026-10-21', '2027-04-04']) {
      ENTITLEMENTS.forEach((_, i) => {
        for (const v of flatDay(i, date)) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(MAX_DEMAND_WH);
        }
      });
    }
    expect(flatDay(0, '2026-10-04')).toHaveLength(276);
  });

  it('uses a low overnight base (fridge and standby), not hundreds of watts', () => {
    const day = flatDay(0, '2026-10-21'); // 1 person
    const night = day.slice(2 * 12, 4 * 12); // 02:00–04:00
    const avgWatts = (night.reduce((s, x) => s + x, 0) / night.length) * 12;
    expect(avgWatts).toBeGreaterThan(80);
    expect(avgWatts).toBeLessThan(250);
  });

  describe('heating and cooling', () => {
    const at = (c: number | null) => () => c;

    it('adds nothing between 16 °C and 26 °C, or without a temperature', () => {
      expect(flatDay(2, '2026-10-21', at(20))).toEqual(
        flatDay(2, '2026-10-21'),
      );
      expect(flatDay(2, '2026-10-21', at(null))).toEqual(
        flatDay(2, '2026-10-21'),
      );
    });

    it('adds heating below 16 °C and cooling above 26 °C, more the further out', () => {
      const base = kwh(flatDay(2, '2026-10-21'));
      const cool = kwh(flatDay(2, '2026-10-21', at(14)));
      const cold = kwh(flatDay(2, '2026-10-21', at(8)));
      const hot = kwh(flatDay(2, '2026-10-21', at(32)));
      expect(cool).toBeGreaterThan(base);
      expect(cold).toBeGreaterThan(cool);
      expect(hot).toBeGreaterThan(base);
    });

    it('is capped', () => {
      expect(kwh(flatDay(2, '2026-10-21', at(-40)))).toBeCloseTo(
        kwh(flatDay(2, '2026-10-21', at(-20))),
        6,
      );
    });
  });
});
