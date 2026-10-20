import {
  HourlyIrradiance,
  intervalIrradiance,
  irradianceAt,
  maxSolarWh,
  PERFORMANCE_RATIO,
  solarWhFromIrradiance,
} from './profiles';

const H = 3_600_000;
const T0 = Date.parse('2026-10-20T00:00:00.000Z');

/** Hour means ending at T0+1h, T0+2h, … (Open-Meteo's "preceding hour" convention). */
function series(values: number[]): HourlyIrradiance[] {
  return values.map((wm2, i) => ({ endsAt: T0 + (i + 1) * H, wm2 }));
}

describe('solarWhFromIrradiance', () => {
  it('uses capacity × irradiance / 1000 × performance ratio × 5/60', () => {
    expect(PERFORMANCE_RATIO).toBe(0.8);
    // 10 kW at 1000 W/m² for 5 min: 10000 × 1 × 0.8 / 12 = 666.7 → 667 Wh
    expect(solarWhFromIrradiance(10_000, 1000, 5)).toBe(667);
    // 10 kW at 500 W/m²: 333.3 → 333 Wh
    expect(solarWhFromIrradiance(10_000, 500, 5)).toBe(333);
  });

  it('is 0 at night and never negative', () => {
    expect(solarWhFromIrradiance(10_000, 0, 5)).toBe(0);
    expect(solarWhFromIrradiance(10_000, -3, 5)).toBe(0);
  });

  it('never exceeds the interval cap, even in very strong sunlight', () => {
    expect(maxSolarWh(10_000, 5)).toBe(833);
    expect(solarWhFromIrradiance(10_000, 1400, 5)).toBe(833);
  });

  it('always returns a whole number of Wh', () => {
    for (let wm2 = 0; wm2 <= 1200; wm2 += 7) {
      expect(Number.isInteger(solarWhFromIrradiance(10_000, wm2, 5))).toBe(
        true,
      );
    }
  });
});

describe('irradianceAt (hour means centred at half past the previous hour)', () => {
  const s = series([0, 100, 300]); // centres at 00:30, 01:30, 02:30

  it('returns the hour mean at its centre', () => {
    expect(irradianceAt(s, T0 + 1.5 * H)).toBe(100);
  });

  it('interpolates linearly between centres', () => {
    expect(irradianceAt(s, T0 + 2 * H)).toBe(200); // halfway 01:30 → 02:30
    expect(irradianceAt(s, T0 + 1.75 * H)).toBe(150);
  });

  it('returns null outside the series', () => {
    expect(irradianceAt(s, T0)).toBeNull();
    expect(irradianceAt(s, T0 + 3 * H)).toBeNull();
    expect(irradianceAt([], T0)).toBeNull();
  });
});

describe('intervalIrradiance', () => {
  it('samples at the middle of the 5-minute interval', () => {
    const s = series([0, 120]); // centres 00:30 (0) and 01:30 (120)
    // Interval 00:55–01:00 has its midpoint at 00:57:30 → 27.5 min past 00:30.
    const start = new Date(T0 + 55 * 60_000);
    expect(intervalIrradiance(s, start, 5)).toBeCloseTo((120 * 27.5) / 60, 10);
  });
});
