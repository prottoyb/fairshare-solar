import { BadRequestException, Injectable } from '@nestjs/common';
import { BuildingsService } from '../buildings/buildings.service';
import { localDayRange } from '../common/local-time';
import { SITE } from '../common/site';
import { PrismaService } from '../prisma/prisma.service';

export type DailySummary = {
  date: string;
  building: {
    intervals: number;
    solarWh: number;
    allocatedWh: number;
    exportedWh: number;
    demandWh: number;
    solarUsedPct: number;
  };
  apartments: {
    apartmentId: string;
    label: string;
    lotEntitlement: number;
    demandWh: number;
    allocatedWh: number;
    selfSufficiencyPct: number;
    shareOfSolarPct: number;
  }[];
};

/** part / whole as a percentage to 1 decimal; a zero denominator gives 0. */
function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part * 1000) / whole) / 10;
}

@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly buildings: BuildingsService,
  ) {}

  /**
   * Totals for one Melbourne local day (ADR-008), summed in Postgres rather than
   * in memory (§6.5).
   */
  async daily(buildingId: string, date: string): Promise<DailySummary> {
    let range: { start: Date; end: Date };
    try {
      range = localDayRange(date, SITE.timeZone);
    } catch {
      throw new BadRequestException('date must be a real YYYY-MM-DD date');
    }
    const building = await this.buildings.get(buildingId); // 404 if unknown

    const readingWhere = {
      buildingId,
      intervalStart: { gte: range.start, lt: range.end },
    };
    const [totals, allocations, demands] = await Promise.all([
      this.prisma.reading.aggregate({
        where: readingWhere,
        _sum: { solarWh: true, exportedWh: true },
        _count: { _all: true },
      }),
      this.prisma.allocation.groupBy({
        by: ['apartmentId'],
        where: { reading: readingWhere },
        _sum: { allocatedWh: true },
      }),
      this.prisma.demand.groupBy({
        by: ['apartmentId'],
        where: { reading: readingWhere },
        _sum: { demandWh: true },
      }),
    ]);

    const allocatedBy = new Map(
      allocations.map((a) => [a.apartmentId, a._sum.allocatedWh ?? 0]),
    );
    const demandBy = new Map(
      demands.map((d) => [d.apartmentId, d._sum.demandWh ?? 0]),
    );
    const solarWh = totals._sum.solarWh ?? 0;
    const allocatedWh = [...allocatedBy.values()].reduce((s, x) => s + x, 0);
    const demandWh = [...demandBy.values()].reduce((s, x) => s + x, 0);

    return {
      date,
      building: {
        intervals: totals._count._all,
        solarWh,
        allocatedWh,
        exportedWh: totals._sum.exportedWh ?? 0,
        demandWh,
        solarUsedPct: pct(allocatedWh, solarWh),
      },
      apartments: building.apartments.map((apt) => {
        const allocated = allocatedBy.get(apt.id) ?? 0;
        const demand = demandBy.get(apt.id) ?? 0;
        return {
          apartmentId: apt.id,
          label: apt.label,
          lotEntitlement: apt.lotEntitlement,
          demandWh: demand,
          allocatedWh: allocated,
          selfSufficiencyPct: pct(allocated, demand),
          shareOfSolarPct: pct(allocated, allocatedWh),
        };
      }),
    };
  }
}
