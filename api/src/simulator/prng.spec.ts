import { mulberry32, randInt } from './prng';

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('gives a different sequence for a different seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    const same = Array.from({ length: 10 }, () => a() === b());
    expect(same.every(Boolean)).toBe(false);
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('randInt', () => {
  it('stays within the inclusive bounds and hits both ends', () => {
    const rng = mulberry32(1);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const n = randInt(rng, 3, 6);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });
});
