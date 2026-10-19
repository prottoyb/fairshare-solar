import { mulberry32, randInt } from '../simulator/prng';
import { allocate, AllocationResult, ApartmentInput } from './allocate';

const ids = ['a', 'b', 'c'];

function apartments(weights: number[], demands: number[]): ApartmentInput[] {
  return weights.map((weight, i) => ({
    id: ids[i],
    weight,
    demandWh: demands[i],
  }));
}

function allocated(result: AllocationResult): number[] {
  return result.allocations.map((a) => a.allocatedWh);
}

function sum(xs: number[]): number {
  return xs.reduce((acc, x) => acc + x, 0);
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function byId(result: AllocationResult): Record<string, number> {
  return Object.fromEntries(
    result.allocations.map((a) => [a.id, a.allocatedWh]),
  );
}

function randomCase(rng: () => number): {
  solarWh: number;
  input: ApartmentInput[];
} {
  const n = randInt(rng, 1, 12);
  const input = Array.from({ length: n }, (_, i) => ({
    id: `apt-${i}`,
    weight: randInt(rng, 1, 50),
    demandWh: randInt(rng, 0, 3000),
  }));
  return { solarWh: randInt(rng, 0, 2500), input };
}

/** Checks I1, I2, I3 and I6 for one result. */
function expectInvariants(
  solarWh: number,
  input: ApartmentInput[],
  result: AllocationResult,
): void {
  const alloc = allocated(result);
  // I6 integers >= 0
  for (const x of [...alloc, result.exportedWh]) {
    expect(Number.isInteger(x)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(0);
  }
  // I1 conservation
  expect(sum(alloc) + result.exportedWh).toBe(solarWh);
  // I2 never over-supply
  input.forEach((apt, i) => expect(alloc[i]).toBeLessThanOrEqual(apt.demandWh));
  // I3 no waste
  if (result.exportedWh > 0) {
    input.forEach((apt, i) => expect(alloc[i]).toBe(apt.demandWh));
  }
}

describe('allocate: worked examples', () => {
  it.each([
    ['Surplus', 1000, [1, 1, 1], [100, 200, 300], [100, 200, 300], 400],
    ['Scarce, equal', 300, [1, 1, 1], [500, 500, 500], [100, 100, 100], 0],
    ['Redistribute', 300, [1, 1, 1], [50, 500, 500], [50, 125, 125], 0],
    ['Scarce, weighted', 100, [10, 30], [1000, 1000], [25, 75], 0],
    ['Remainder', 10, [1, 1, 1], [100, 100, 100], [4, 3, 3], 0],
    ['Zero solar', 0, [1, 1], [100, 100], [0, 0], 0],
    ['Zero demand', 500, [1, 1], [0, 0], [0, 0], 500],
  ])(
    '%s',
    (_name, solarWh, weights, demands, expectedAlloc, expectedExport) => {
      const result = allocate(solarWh, apartments(weights, demands));
      expect(result.allocations.map((a) => a.id)).toEqual(
        ids.slice(0, weights.length),
      );
      expect(allocated(result)).toEqual(expectedAlloc);
      expect(result.exportedWh).toBe(expectedExport);
    },
  );
});

describe('allocate: invariants', () => {
  it('I1 conservation: allocated + exported equals solar', () => {
    const result = allocate(777, apartments([1, 2, 3], [100, 900, 50]));
    expect(sum(allocated(result)) + result.exportedWh).toBe(777);
  });

  it('I2 never gives an apartment more than its demand', () => {
    const result = allocate(2500, apartments([1, 1, 50], [10, 20, 30]));
    expect(allocated(result)).toEqual([10, 20, 30]);
  });

  it('I3 exports only when every demand is fully met', () => {
    const scarce = allocate(100, apartments([1, 1], [60, 60]));
    expect(scarce.exportedWh).toBe(0);
    const surplus = allocate(130, apartments([1, 1], [60, 60]));
    expect(surplus.exportedWh).toBe(10);
    expect(allocated(surplus)).toEqual([60, 60]);
  });

  it('I4 is proportional (within 1 Wh) when solar is scarce', () => {
    // Fixed cases where every demand covers its proportional share.
    const cases: [number, number[]][] = [
      [10, [2, 1, 1]], // exact shares 5, 2.5, 2.5
      [10, [1, 1, 1]],
      [100, [10, 30]],
      [7, [3, 3, 1]],
      [2003, [10, 10, 15, 15, 20, 30]],
    ];
    for (const [solarWh, weights] of cases) {
      const input = weights.map((weight, i) => ({
        id: `apt-${i}`,
        weight,
        demandWh: 5000,
      }));
      const W = sum(weights);
      const result = allocate(solarWh, input);
      result.allocations.forEach((a, i) => {
        expect(
          Math.abs(a.allocatedWh - (solarWh * weights[i]) / W),
        ).toBeLessThan(1);
      });
    }
  });

  it('I4 regression: rounding dust goes by largest remainder, not weight', () => {
    // Exact shares 5 / 2.5 / 2.5. Handing the spare 1 Wh to the heaviest
    // apartment (6/2/2) would put it a full 1 Wh off its share.
    const result = allocate(10, apartments([2, 1, 1], [100, 100, 100]));
    expect(allocated(result)).toEqual([5, 3, 2]);
  });

  it('I4 holds for 1,000 random scarce cases', () => {
    const rng = mulberry32(2024);
    for (let c = 0; c < 1000; c++) {
      const n = randInt(rng, 1, 12);
      const weights = Array.from({ length: n }, () => randInt(rng, 1, 50));
      const W = sum(weights);
      const solarWh = randInt(rng, 0, 2500);
      // Each demand is at least its proportional share, so Σ demand >= solar.
      const input = weights.map((weight, i) => ({
        id: `apt-${i}`,
        weight,
        demandWh: Math.ceil((solarWh * weight) / W) + randInt(rng, 0, 500),
      }));
      const result = allocate(solarWh, input);
      result.allocations.forEach((a, i) => {
        expect(
          Math.abs(a.allocatedWh - (solarWh * weights[i]) / W),
        ).toBeLessThan(1);
      });
    }
  });

  it('I5 is deterministic and independent of input order', () => {
    const input = apartments([1, 1, 1], [100, 100, 100]);
    const forward = byId(allocate(10, input));
    const reversed = byId(allocate(10, [...input].reverse()));
    expect(reversed).toEqual(forward);
    expect(byId(allocate(10, input))).toEqual(forward);
  });

  it('I5 returns allocations in input order', () => {
    const input = apartments([1, 2, 3], [10, 20, 30]).reverse();
    expect(allocate(60, input).allocations.map((a) => a.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('I6 outputs are non-negative integers', () => {
    const result = allocate(1, apartments([7, 11, 13], [1, 1, 1]));
    for (const x of [...allocated(result), result.exportedWh]) {
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
    }
    expect(sum(allocated(result))).toBe(1);
  });
});

describe('allocate: seeded property test', () => {
  it('holds I1, I2, I3, I5 and I6 for 1,000 random cases', () => {
    const rng = mulberry32(42);
    for (let c = 0; c < 1000; c++) {
      const { solarWh, input } = randomCase(rng);
      const result = allocate(solarWh, input);
      expectInvariants(solarWh, input, result);
      expect(byId(allocate(solarWh, shuffle(input, rng)))).toEqual(
        byId(result),
      );
    }
  });
});

describe('allocate: input validation', () => {
  const ok = apartments([1, 1], [100, 100]);

  it.each([
    ['non-integer solar', 1.5, ok],
    ['negative solar', -1, ok],
    ['NaN solar', Number.NaN, ok],
    ['infinite solar', Number.POSITIVE_INFINITY, ok],
    ['empty apartment list', 100, []],
    ['zero weight', 100, apartments([0, 1], [100, 100])],
    ['negative weight', 100, apartments([-1, 1], [100, 100])],
    ['non-integer weight', 100, apartments([1.5, 1], [100, 100])],
    ['negative demand', 100, apartments([1, 1], [-5, 100])],
    ['non-integer demand', 100, apartments([1, 1], [10.5, 100])],
    ['NaN demand', 100, apartments([1, 1], [Number.NaN, 100])],
    [
      'duplicate ids',
      100,
      [
        { id: 'a', weight: 1, demandWh: 10 },
        { id: 'a', weight: 1, demandWh: 10 },
      ],
    ],
    [
      'values too large for exact integer maths',
      Number.MAX_SAFE_INTEGER,
      apartments([1000, 1], [100, 100]),
    ],
  ])('throws RangeError for %s', (_name, solarWh, input) => {
    expect(() => allocate(solarWh, input)).toThrow(RangeError);
  });

  it('does not mutate its input', () => {
    const input = apartments([1, 2], [100, 100]);
    const copy = structuredClone(input);
    allocate(50, input);
    expect(input).toEqual(copy);
  });
});
