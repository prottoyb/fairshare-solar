import { PrismaClient } from '@prisma/client';
import { upsertDemoBuilding } from '../../prisma/demo-building';

/** Refuse to wipe anything but the test database, whatever env got loaded. */
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  const dbName = url ? new URL(url).pathname.slice(1) : '';
  if (dbName !== 'fairshare_test') {
    throw new Error(
      `e2e tests only run against fairshare_test (got "${dbName || 'unset'}"). ` +
        'Run them with: npm run test:e2e -w api',
    );
  }
}

/** Empty every table and re-seed the demo building. Returns the building id. */
export async function resetDb(prisma: PrismaClient): Promise<string> {
  assertTestDatabase();
  await prisma.$executeRaw`TRUNCATE "Allocation", "Demand", "Reading", "Apartment", "Building" RESTART IDENTITY CASCADE`;
  const building = await upsertDemoBuilding(prisma);
  return building.id;
}
