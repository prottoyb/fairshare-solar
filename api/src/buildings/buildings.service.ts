import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SplitMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const buildingDetail = {
  id: true,
  name: true,
  capacityW: true,
  splitMode: true,
  intervalMinutes: true,
  apartments: {
    select: { id: true, label: true, lotEntitlement: true },
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
    if (!building) throw notFound(id);
    return building;
  }

  async setSplitMode(
    id: string,
    splitMode: SplitMode,
  ): Promise<BuildingDetail> {
    try {
      return await this.prisma.building.update({
        where: { id },
        data: { splitMode },
        select: buildingDetail,
      });
    } catch (err) {
      // P2025: the record to update does not exist.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw notFound(id);
      }
      throw err;
    }
  }
}

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Building ${id} not found`);
}
