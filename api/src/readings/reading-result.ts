import { Prisma, SplitMode } from '@prisma/client';

/** Shape of an ingest response, a readings list item and the `reading` event. */
export type ReadingResult = {
  readingId: string;
  buildingId: string;
  intervalStart: string;
  solarWh: number;
  exportedWh: number;
  splitModeUsed: SplitMode;
  replayed: boolean;
  allocations: {
    apartmentId: string;
    label: string;
    lotEntitlement: number;
    demandWh: number;
    allocatedWh: number;
  }[];
};

export const readingInclude = {
  demands: { select: { apartmentId: true, demandWh: true } },
  allocations: {
    select: {
      apartmentId: true,
      allocatedWh: true,
      apartment: { select: { label: true, lotEntitlement: true } },
    },
    orderBy: { apartment: { label: 'asc' } },
  },
} satisfies Prisma.ReadingInclude;

export type ReadingWithRows = Prisma.ReadingGetPayload<{
  include: typeof readingInclude;
}>;

export function toReadingResult(
  reading: ReadingWithRows,
  replayed: boolean,
): ReadingResult {
  const demandById = new Map(
    reading.demands.map((d) => [d.apartmentId, d.demandWh]),
  );
  return {
    readingId: reading.id,
    buildingId: reading.buildingId,
    intervalStart: reading.intervalStart.toISOString(),
    solarWh: reading.solarWh,
    exportedWh: reading.exportedWh,
    splitModeUsed: reading.splitModeUsed,
    replayed,
    allocations: reading.allocations.map((a) => ({
      apartmentId: a.apartmentId,
      label: a.apartment.label,
      lotEntitlement: a.apartment.lotEntitlement,
      demandWh: demandById.get(a.apartmentId) ?? 0,
      allocatedWh: a.allocatedWh,
    })),
  };
}
