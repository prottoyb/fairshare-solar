import { PrismaClient, SplitMode } from '@prisma/client';

/** Seed data from SPEC.md §5.6. */
export const DEMO_BUILDING = {
  name: 'Demo Building A',
  capacityW: 30000,
  splitMode: SplitMode.EQUAL,
  intervalMinutes: 5,
} as const;

export { SIM_DEVICE_ID as DEMO_DEVICE_ID } from '../src/simulator/simulator.constants';

export const DEMO_APARTMENTS = [10, 10, 15, 15, 20, 30].map(
  (lotEntitlement, i) => ({ label: `Unit ${i + 1}`, lotEntitlement }),
);

/**
 * Idempotent: finds the building by name (names aren't unique in the schema, so this
 * can't be a Prisma upsert) and upserts apartments by (buildingId, label).
 * Re-running leaves one building with six apartments. An existing building keeps its
 * current split mode.
 */
export async function upsertDemoBuilding(
  prisma: PrismaClient,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.building.findFirst({
      where: { name: DEMO_BUILDING.name },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const building =
      existing ??
      (await tx.building.create({
        data: DEMO_BUILDING,
        select: { id: true },
      }));

    for (const apt of DEMO_APARTMENTS) {
      await tx.apartment.upsert({
        where: {
          buildingId_label: { buildingId: building.id, label: apt.label },
        },
        create: { buildingId: building.id, ...apt },
        update: { lotEntitlement: apt.lotEntitlement },
      });
    }
    return building;
  });
}
