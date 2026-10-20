import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { INTERVAL_MINUTES } from '../src/common/limits';
import {
  addDaysToDateString,
  localDateString,
  localDayRange,
} from '../src/common/local-time';
import { SITE } from '../src/common/site';
import { addMinutes } from '../src/common/time';
import { ReadingsService } from '../src/readings/readings.service';
import { ReadingGenerator } from '../src/simulator/reading-generator';
import { SIM_DEVICE_ID } from '../src/simulator/simulator.constants';
import { WeatherService } from '../src/weather/weather.service';

export type HistoryResult = {
  date: string;
  created: number;
  replayed: number;
  conflicts: number;
  /** Intervals that used the clear-sky curve because weather was unavailable. */
  fallbackIntervals: number;
};

/**
 * F12: yesterday (Melbourne local day: 288 intervals, or 276 / 300 on daylight-
 * saving days) through ReadingsService.ingest(), the same validated path as HTTP
 * (ADR-004). Solar comes from WeatherService for each interval (ADR-008).
 * Deterministic for a given seed and weather, so re-running gives replays, not
 * duplicates. A 409 (that interval already holds different data) is counted and
 * skipped rather than failing the seed.
 */
export async function seedHistory(
  prisma: PrismaClient,
  readings: ReadingsService,
  weather: WeatherService,
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
    SITE.timeZone,
  );

  const date = addDaysToDateString(localDateString(now, SITE.timeZone), -1);
  const { start, end } = localDayRange(date, SITE.timeZone);
  const result: HistoryResult = {
    date,
    created: 0,
    replayed: 0,
    conflicts: 0,
    fallbackIntervals: 0,
  };
  for (let at = start; at < end; at = addMinutes(at, INTERVAL_MINUTES)) {
    const irradiance = await weather.irradianceForInterval(
      at,
      INTERVAL_MINUTES,
    );
    if (irradiance === null) result.fallbackIntervals++;
    const dto = generator.next(at, irradiance);
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
