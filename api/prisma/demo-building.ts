import { PrismaClient, SplitMode } from '@prisma/client';

/**
 * Seed data from SPEC.md §5.6. The building is in Fawkner VIC (common/site.ts).
 * 10 kW ≈ 1.7 kW per apartment, so real weather produces shortfalls (ADR-008).
 */
export const DEMO_BUILDING = {
  name: "Prottoy's Apartment",
  capacityW: 10_000,
  splitMode: SplitMode.EQUAL,
  intervalMinutes: 5,
} as const;

export { SIM_DEVICE_ID as DEMO_DEVICE_ID } from '../src/simulator/simulator.constants';

const ENTITLEMENTS = [10, 10, 15, 15, 20, 30];
/**
 * Default owner-set shares (ADR-010), totalling 100 %. Visibly different from
 * Equal (16.7 % each) and from Entitlement (10/10/15/15/20/30).
 */
export const DEFAULT_SHARES_PCT = [15, 15, 15, 15, 20, 20];

export const DEMO_APARTMENTS = ENTITLEMENTS.map((lotEntitlement, i) => ({
  label: `Unit ${i + 1}`,
  lotEntitlement,
  customSharePct: DEFAULT_SHARES_PCT[i],
}));

/**
 * Idempotent: finds the building by name (names aren't unique in the schema, so this
 * can't be a Prisma upsert) and upserts apartments by (buildingId, label).
 * Re-running leaves one building with six apartments. An existing building keeps its
 * current split mode, and apartments keep owner-set shares already chosen.
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
      const where = {
        buildingId_label: { buildingId: building.id, label: apt.label },
      };
      const current = await tx.apartment.findUnique({
        where,
        select: { customSharePct: true },
      });
      await tx.apartment.upsert({
        where,
        create: { buildingId: building.id, ...apt },
        update: {
          lotEntitlement: apt.lotEntitlement,
          // Only fill a missing share; never overwrite the owner's choice.
          ...(current?.customSharePct == null
            ? { customSharePct: apt.customSharePct }
            : {}),
        },
      });
    }
    return building;
  });
}
