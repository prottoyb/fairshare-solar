import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReadingsService } from '../src/readings/readings.service';
import { DEFAULT_SIM_SEED } from '../src/simulator/simulator.constants';
import { upsertDemoBuilding } from './demo-building';
import { seedHistory } from './seed-history';

/**
 * Idempotent seed: Demo Building A and its apartments, then yesterday's history
 * through the real ingest service (F12). Boots Nest without an HTTP server.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const prisma = app.get(PrismaService);
    const building = await upsertDemoBuilding(prisma);
    Logger.log(`Demo Building A ready (${building.id})`, 'Seed');

    const configured = Number(app.get(ConfigService).get<string>('SIM_SEED'));
    const seed = Number.isInteger(configured) ? configured : DEFAULT_SIM_SEED;
    const history = await seedHistory(
      prisma,
      app.get(ReadingsService),
      building.id,
      seed,
    );
    Logger.log(
      `History for ${history.date}: ${history.created} created, ` +
        `${history.replayed} replayed, ${history.conflicts} conflicts`,
      'Seed',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  Logger.error(err, 'Seed');
  process.exit(1);
});
