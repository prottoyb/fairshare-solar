import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SplitMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShareDto } from './dto/set-shares.dto';

const buildingDetail = {
  id: true,
  name: true,
  capacityW: true,
  splitMode: true,
  intervalMinutes: true,
  apartments: {
    select: {
      id: true,
      label: true,
      lotEntitlement: true,
      customSharePct: true,
    },
    orderBy: { label: 'asc' },
  },
} satisfies Prisma.BuildingSelect;

export type BuildingSummary = {
  id: string;
  name: string;
  splitMode: SplitMode;
  capacityW: number;
};
export type BuildingDetail = Prisma.BuildingGetPayload<{
  select: typeof buildingDetail;
}>;

@Injectable()
export class BuildingsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<BuildingSummary[]> {
    return this.prisma.building.findMany({
      select: { id: true, name: true, splitMode: true, capacityW: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string): Promise<BuildingDetail> {
    const building = await this.prisma.building.findUnique({
      where: { id },
      select: buildingDetail,
    });
    if (!building) throw buildingNotFound(id);
    return building;
  }

  /** Changes the split mode; applies from the next interval (ADR-003). */
  async setSplitMode(
    id: string,
    splitMode: SplitMode,
  ): Promise<BuildingDetail> {
    return this.prisma.$transaction(async (tx) => {
      const building = await tx.building.findUnique({
        where: { id },
        select: {
          apartments: {
            select: { label: true, customSharePct: true },
            orderBy: { label: 'asc' },
          },
        },
      });
      if (!building) throw buildingNotFound(id);
      if (splitMode === SplitMode.CUSTOM) {
        const missing = building.apartments
          .filter((a) => a.customSharePct === null)
          .map((a) => a.label);
        if (missing.length > 0) {
          throw new BadRequestException(
            `Set an owner share for every apartment before choosing CUSTOM (missing: ${missing.join(', ')})`,
          );
        }
      }
      return tx.building.update({
        where: { id },
        data: { splitMode },
        select: buildingDetail,
      });
    });
  }

  /**
   * Sets every apartment's owner share (ADR-010). Checks in order: building
   * exists (404), exactly one entry per apartment, total exactly 100 (400).
   * Applies from the next interval; past readings keep their allocations.
   */
  async setShares(id: string, shares: ShareDto[]): Promise<BuildingDetail> {
    return this.prisma.$transaction(async (tx) => {
      const building = await tx.building.findUnique({
        where: { id },
        select: { apartments: { select: { id: true } } },
      });
      if (!building) throw buildingNotFound(id);

      assertOneSharePerApartment(
        building.apartments.map((a) => a.id),
        shares,
      );
      const total = shares.reduce((s, x) => s + x.sharePct, 0);
      if (total !== 100) {
        throw new BadRequestException(
          `shares must total exactly 100 % (got ${total} %)`,
        );
      }

      for (const share of shares) {
        await tx.apartment.update({
          where: { id: share.apartmentId },
          data: { customSharePct: share.sharePct },
        });
      }
      return tx.building.findUniqueOrThrow({
        where: { id },
        select: buildingDetail,
      });
    });
  }
}

export function buildingNotFound(id: string): NotFoundException {
  return new NotFoundException(`Building ${id} not found`);
}

/** Exactly one share per apartment of the building; names every offending id. */
function assertOneSharePerApartment(
  apartmentIds: string[],
  shares: ShareDto[],
): void {
  const expected = new Set(apartmentIds);
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const duplicate = new Set<string>();
  for (const { apartmentId } of shares) {
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
      `shares must have exactly one entry per apartment of this building (${problems.join('; ')})`,
    );
  }
}
