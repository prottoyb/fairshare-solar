import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { INTERVAL_MINUTES } from '../src/common/limits';
import { addMinutes, startOfUtcDay } from '../src/common/time';
import { ReadingsService } from '../src/readings/readings.service';
import { ReadingGenerator } from '../src/simulator/reading-generator';
import { SIM_DEVICE_ID } from '../src/simulator/simulator.constants';

export type HistoryResult = {
  date: string;
  created: number;
  replayed: number;
  conflicts: number;
};

const INTERVALS_PER_DAY = (24 * 60) / INTERVAL_MINUTES; // 288

/**
 * F12: yesterday's (UTC) 288 intervals through ReadingsService.ingest(), the same
 * validated path as HTTP (ADR-004). Deterministic for a given seed, so re-running
 * gives replays, not duplicates. A 409 (that interval already holds different
 * simulator data) is counted and skipped rather than failing the seed.
 */
export async function seedHistory(
  prisma: PrismaClient,
  readings: ReadingsService,
  buildingId: string,
  seed: number,
  now = new Date(),
): Promise<HistoryResult> {
  const building = await prisma.building.findUniqueOrThrow({
    where: { id: buildingId },
    select: {
      capacityW: true,
      apartments: { select: { id: true }, orderBy: { label: 'asc' } },
    },
  });
  const generator = new ReadingGenerator(
    seed,
    building.apartments.map((a) => a.id),
    building.capacityW,
    SIM_DEVICE_ID,
  );

  const start = addMinutes(startOfUtcDay(now), -24 * 60);
  const result: HistoryResult = {
    date: start.toISOString().slice(0, 10),
    created: 0,
    replayed: 0,
    conflicts: 0,
  };
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    const dto = generator.next(addMinutes(start, i * INTERVAL_MINUTES));
    try {
      const stored = await readings.ingest(buildingId, dto);
      if (stored.replayed) result.replayed++;
      else result.created++;
    } catch (err) {
      if (err instanceof ConflictException) result.conflicts++;
      else throw err;
    }
  }
  return result;
}
