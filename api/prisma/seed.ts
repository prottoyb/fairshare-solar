import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReadingsService } from '../src/readings/readings.service';
import { DEFAULT_SIM_SEED } from '../src/simulator/simulator.constants';
import { WeatherService } from '../src/weather/weather.service';
import { DEMO_BUILDING, upsertDemoBuilding } from './demo-building';
import { seedHistory } from './seed-history';

/**
 * Idempotent seed: the demo building and its apartments, then yesterday's history
 * (Melbourne local day, solar from real weather) through the real ingest service
 * (F12, ADR-008). Boots Nest without an HTTP server.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const prisma = app.get(PrismaService);
    const building = await upsertDemoBuilding(prisma);
    Logger.log(`${DEMO_BUILDING.name} ready (${building.id})`, 'Seed');

    const configured = Number(app.get(ConfigService).get<string>('SIM_SEED'));
    const seed = Number.isInteger(configured) ? configured : DEFAULT_SIM_SEED;
    const history = await seedHistory(
      prisma,
      app.get(ReadingsService),
      app.get(WeatherService),
      building.id,
      seed,
    );
    Logger.log(
      `History for ${history.date} (Melbourne): ${history.created} created, ` +
        `${history.replayed} replayed, ${history.conflicts} conflicts, ` +
        `${history.fallbackIntervals} intervals on the clear-sky fallback`,
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
