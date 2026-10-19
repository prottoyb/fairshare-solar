/**
 * Allocation engine: shares one interval's solar between apartments.
 * Pure function: no I/O, no framework imports. All energy is integer Wh (ADR-001).
 */

/** weight: 1 for EQUAL, lotEntitlement for ENTITLEMENT. */
export type ApartmentInput = { id: string; weight: number; demandWh: number };
export type AllocationResult = {
  allocations: { id: string; allocatedWh: number }[];
  exportedWh: number;
};

function validate(solarWh: number, apartments: ApartmentInput[]): void {
  if (!Number.isInteger(solarWh) || solarWh < 0) {
    throw new RangeError(`solarWh must be an integer >= 0 (got ${solarWh})`);
  }
  if (apartments.length === 0) {
    throw new RangeError('apartments must not be empty');
  }
  const seen = new Set<string>();
  let totalWeight = 0;
  let maxDemand = 0;
  for (const apt of apartments) {
    if (seen.has(apt.id)) {
      throw new RangeError(`duplicate apartment id "${apt.id}"`);
    }
    seen.add(apt.id);
    if (!Number.isInteger(apt.weight) || apt.weight <= 0) {
      throw new RangeError(`weight for "${apt.id}" must be an integer > 0`);
    }
    if (!Number.isInteger(apt.demandWh) || apt.demandWh < 0) {
      throw new RangeError(`demandWh for "${apt.id}" must be an integer >= 0`);
    }
    totalWeight += apt.weight;
    maxDemand = Math.max(maxDemand, apt.demandWh);
  }
  // The engine multiplies remaining × weight and unmet × total weight. With ingest's
  // bounds (solar <= 2,500 Wh, demand <= 10,000 Wh, weights = lot entitlements) that
  // stays far below Number.MAX_SAFE_INTEGER; this guard keeps the maths exact for
  // any other caller.
  if (Math.max(solarWh, maxDemand) * totalWeight > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      'inputs exceed the safe integer range for exact maths',
    );
  }
}

/**
 * Water-filling: solar is shared in proportion to weight, but nobody gets more than
 * they are using; energy an apartment can't use is shared again among the rest, and
 * only energy nobody can use is exported.
 *
 * Each round compares exact shares in integers (remaining × weight vs unmet × W):
 * - anyone whose exact share covers their unmet demand is filled and drops out, and
 *   the rest is shared again;
 * - once nobody is capped, everyone gets floor(exact share) and the leftover Wh
 *   (fewer than the number of apartments) go one each by largest fractional
 *   remainder, then weight descending, then id ascending. This keeps every
 *   apartment within 1 Wh of its proportional share (invariant I4).
 */
export function allocate(
  solarWh: number,
  apartments: ApartmentInput[],
): AllocationResult {
  validate(solarWh, apartments);

  const given = new Map<string, number>(apartments.map((a) => [a.id, 0]));
  let active = apartments.filter((a) => a.demandWh > 0);
  const unmet = (a: ApartmentInput): number => a.demandWh - given.get(a.id)!;
  let remaining = solarWh;

  while (remaining > 0 && active.length > 0) {
    const W = active.reduce((acc, a) => acc + a.weight, 0);
    const capped = active.filter((a) => remaining * a.weight >= unmet(a) * W);

    if (capped.length > 0) {
      // Their exact shares cover them, so the total handed out here is <= remaining.
      for (const apt of capped) {
        remaining -= unmet(apt);
        given.set(apt.id, apt.demandWh);
      }
      active = active.filter((a) => unmet(a) > 0);
      continue;
    }

    // Nobody is capped: floor each exact share, then place the rounding dust.
    const shares = active.map((apt) => ({
      apt,
      floor: Math.floor((remaining * apt.weight) / W),
      fraction: (remaining * apt.weight) % W, // numerator over W
    }));
    let dust = remaining;
    for (const s of shares) {
      given.set(s.apt.id, s.floor);
      dust -= s.floor;
    }
    shares
      .sort(
        (x, y) =>
          y.fraction - x.fraction ||
          y.apt.weight - x.apt.weight ||
          x.apt.id.localeCompare(y.apt.id),
      )
      .slice(0, dust)
      .forEach((s) => given.set(s.apt.id, s.floor + 1));
    remaining = 0;
  }

  return {
    allocations: apartments.map((a) => ({
      id: a.id,
      allocatedWh: given.get(a.id)!,
    })),
    exportedWh: remaining,
  };
}
