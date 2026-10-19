import { PrismaClient } from '@prisma/client';

export type Apt = { id: string; label: string; lotEntitlement: number };

export type ReadingBody = {
  deviceId: string;
  intervalStart: string;
  solarWh: number;
  demands: { apartmentId: string; demandWh: number }[];
};

export type AllocationItem = {
  apartmentId: string;
  label: string;
  lotEntitlement: number;
  demandWh: number;
  allocatedWh: number;
};

export type ReadingResponse = {
  readingId: string;
  buildingId: string;
  intervalStart: string;
  solarWh: number;
  exportedWh: number;
  splitModeUsed: 'EQUAL' | 'ENTITLEMENT';
  replayed: boolean;
  allocations: AllocationItem[];
};

/** Apartments of a building ordered by label (Unit 1 … Unit 6). */
export function apartmentsOf(
  prisma: PrismaClient,
  buildingId: string,
): Promise<Apt[]> {
  return prisma.apartment.findMany({
    where: { buildingId },
    orderBy: { label: 'asc' },
    select: { id: true, label: true, lotEntitlement: true },
  });
}

/** A valid reading body; `demandWh` is per apartment in label order. */
export function readingBody(
  apartments: Apt[],
  overrides: Partial<Omit<ReadingBody, 'demands'>> & {
    demandWh?: number[];
  } = {},
): ReadingBody {
  const { demandWh, ...rest } = overrides;
  return {
    deviceId: 'sim-device-001',
    intervalStart: '2026-10-20T03:05:00.000Z',
    solarWh: 1000,
    demands: apartments.map((a, i) => ({
      apartmentId: a.id,
      demandWh: demandWh?.[i] ?? 100,
    })),
    ...rest,
  };
}

export async function rowCounts(prisma: PrismaClient): Promise<{
  readings: number;
  demands: number;
  allocations: number;
}> {
  const [readings, demands, allocations] = await Promise.all([
    prisma.reading.count(),
    prisma.demand.count(),
    prisma.allocation.count(),
  ]);
  return { readings, demands, allocations };
}
