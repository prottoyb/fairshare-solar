import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { upsertDemoBuilding } from './demo-building';

// History (yesterday's 288 intervals through ReadingsService.ingest) is added in M5.
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const building = await upsertDemoBuilding(prisma);
    Logger.log(`Demo Building A ready (${building.id})`, 'Seed');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  Logger.error(err, 'Seed');
  process.exit(1);
});
