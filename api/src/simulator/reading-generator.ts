import { INTERVAL_MINUTES } from '../common/limits';
import { utcHourOfDay } from '../common/time';
import { mulberry32 } from './prng';
import { baseDemandWh, demandWh, nextCloud, solarWh } from './profiles';

/** Same shape as CreateReadingDto, so it goes through the one ingest path. */
export type GeneratedReading = {
  deviceId: string;
  intervalStart: string;
  solarWh: number;
  demands: { apartmentId: string; demandWh: number }[];
};

/**
 * Seeded, deterministic source of simulated readings for one building. The same
 * seed, apartments and interval sequence always give the same readings. Used by
 * the simulator and by the seed's history (ADR-004). Pure: no framework imports.
 */
export class ReadingGenerator {
  private readonly rng: () => number;
  private cloud = 1;
  private readonly baseByApartment: Map<string, number>;

  /** `apartmentIds` must be in a stable order (by label) for determinism. */
  constructor(
    seed: number,
    private readonly apartmentIds: string[],
    private readonly capacityW: number,
    private readonly deviceId: string,
  ) {
    this.rng = mulberry32(seed);
    this.baseByApartment = new Map(
      apartmentIds.map((id) => [id, baseDemandWh(this.rng())]),
    );
  }

  next(intervalStart: Date): GeneratedReading {
    const hour = utcHourOfDay(intervalStart);
    this.cloud = nextCloud(this.cloud, this.rng());
    return {
      deviceId: this.deviceId,
      intervalStart: intervalStart.toISOString(),
      solarWh: solarWh(this.capacityW, hour, this.cloud, INTERVAL_MINUTES),
      demands: this.apartmentIds.map((id) => ({
        apartmentId: id,
        demandWh: demandWh(this.baseByApartment.get(id)!, hour, this.rng()),
      })),
    };
  }
}
