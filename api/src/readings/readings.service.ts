import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { allocate } from '../allocation/allocate';
import { buildingNotFound } from '../buildings/buildings.service';
import { INTERVAL_MINUTES } from '../common/limits';
import { isAlignedToInterval } from '../common/time';
import { LiveEventsService } from '../live/live-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReadingDto, DemandDto } from './dto/create-reading.dto';
import { payloadHash } from './payload-hash';
import {
  readingInclude,
  ReadingResult,
  ReadingWithRows,
  toReadingResult,
} from './reading-result';

@Injectable()
export class ReadingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveEventsService,
  ) {}

  /**
   * The one ingestion path (ADR-004), used by HTTP, the simulator and the seed.
   * Checks run in the §5.7 order: DTO (ValidationPipe), alignment, building,
   * capacity, apartment set. Idempotent by (deviceId, intervalStart) (ADR-006).
   */
  async ingest(
    buildingId: string,
    dto: CreateReadingDto,
  ): Promise<ReadingResult> {
    const intervalStart = new Date(dto.intervalStart);
    if (!isAlignedToInterval(intervalStart, INTERVAL_MINUTES)) {
      throw new BadRequestException(
        `intervalStart must align to a ${INTERVAL_MINUTES}-minute boundary`,
      );
    }

    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: {
        capacityW: true,
        intervalMinutes: true,
        apartments: { select: { id: true, lotEntitlement: true } },
      },
    });
    if (!building) throw buildingNotFound(buildingId);
    if (!isAlignedToInterval(intervalStart, building.intervalMinutes)) {
      throw new BadRequestException(
        `intervalStart must align to a ${building.intervalMinutes}-minute boundary`,
      );
    }

    // solarWh <= capacityW × minutes / 60, compared in integers.
    if (dto.solarWh * 60 > building.capacityW * building.intervalMinutes) {
      const maxWh = Math.floor(
        (building.capacityW * building.intervalMinutes) / 60,
      );
      throw new BadRequestException(
        `solarWh ${dto.solarWh} exceeds this building's maximum of ${maxWh} Wh per ${building.intervalMinutes}-minute interval`,
      );
    }

    assertOneDemandPerApartment(
      building.apartments.map((a) => a.id),
      dto.demands,
    );

    const hash = payloadHash(dto);
    const existing = await this.findExisting(dto.deviceId, intervalStart);
    if (existing) return replayOrConflict(existing, buildingId, hash);

    let created: ReadingResult;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Read the mode inside the transaction and snapshot it (ADR-003).
        const { splitMode } = await tx.building.findUniqueOrThrow({
          where: { id: buildingId },
          select: { splitMode: true },
        });
        const demandById = new Map(
          dto.demands.map((d) => [d.apartmentId, d.demandWh]),
        );
        const result = allocate(
          dto.solarWh,
          building.apartments.map((a) => ({
            id: a.id,
            weight: splitMode === 'ENTITLEMENT' ? a.lotEntitlement : 1,
            demandWh: demandById.get(a.id)!, // the set was checked above
          })),
        );

        const reading = await tx.reading.create({
          data: {
            buildingId,
            deviceId: dto.deviceId,
            intervalStart,
            solarWh: dto.solarWh,
            exportedWh: result.exportedWh,
            splitModeUsed: splitMode,
            payloadHash: hash,
            demands: {
              createMany: {
                data: dto.demands.map((d) => ({
                  apartmentId: d.apartmentId,
                  demandWh: d.demandWh,
                })),
              },
            },
            allocations: {
              createMany: {
                data: result.allocations.map((a) => ({
                  apartmentId: a.id,
                  allocatedWh: a.allocatedWh,
                })),
              },
            },
          },
          include: readingInclude,
        });
        return toReadingResult(reading, false);
      });
    } catch (err) {
      // Lost a race to an insert for the same (deviceId, intervalStart):
      // apply the same replay / 409 rule against the row that won.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.findExisting(dto.deviceId, intervalStart);
        if (winner) return replayOrConflict(winner, buildingId, hash);
      }
      throw err;
    }

    // Only after the commit, and never for replays (SPEC.md §5.8).
    this.live.publishReading({ deviceId: dto.deviceId, reading: created });
    return created;
  }

  async list(buildingId: string, limit: number): Promise<ReadingResult[]> {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true },
    });
    if (!building) throw buildingNotFound(buildingId);

    const readings = await this.prisma.reading.findMany({
      where: { buildingId },
      orderBy: { intervalStart: 'desc' },
      take: limit,
      include: readingInclude,
    });
    return readings.map((r) => toReadingResult(r, false));
  }

  private findExisting(
    deviceId: string,
    intervalStart: Date,
  ): Promise<ReadingWithRows | null> {
    return this.prisma.reading.findUnique({
      where: { deviceId_intervalStart: { deviceId, intervalStart } },
      include: readingInclude,
    });
  }
}

/** Same payload for the same building: replay. Anything else: 409. */
function replayOrConflict(
  existing: ReadingWithRows,
  buildingId: string,
  hash: string,
): ReadingResult {
  if (existing.buildingId === buildingId && existing.payloadHash === hash) {
    return toReadingResult(existing, true);
  }
  throw new ConflictException(
    'A different reading for this interval already exists',
  );
}

/** §5.7 check 5: exactly one demand per apartment; names every offending id. */
function assertOneDemandPerApartment(
  apartmentIds: string[],
  demands: DemandDto[],
): void {
  const expected = new Set(apartmentIds);
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const duplicate = new Set<string>();
  for (const { apartmentId } of demands) {
    if (!expected.has(apartmentId)) unknown.add(apartmentId);
    else if (seen.has(apartmentId)) duplicate.add(apartmentId);
    seen.add(apartmentId);
  }
  const missing = apartmentIds.filter((id) => !seen.has(id));

  const problems = [
    missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
    unknown.size > 0 ? `unknown: ${[...unknown].join(', ')}` : '',
    duplicate.size > 0 ? `duplicate: ${[...duplicate].join(', ')}` : '',
  ].filter(Boolean);
  if (problems.length > 0) {
    throw new BadRequestException(
      `demands must have exactly one entry per apartment of this building (${problems.join('; ')})`,
    );
  }
}
