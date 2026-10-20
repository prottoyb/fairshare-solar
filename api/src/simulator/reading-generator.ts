import { INTERVAL_MINUTES } from '../common/limits';
import { localHourOfDay } from '../common/local-time';
import { mulberry32 } from './prng';
import {
  baseDemandWh,
  demandWh,
  nextCloud,
  solarWh,
  solarWhFromIrradiance,
} from './profiles';

/** Same shape as CreateReadingDto, so it goes through the one ingest path. */
export type GeneratedReading = {
  deviceId: string;
  intervalStart: string;
  solarWh: number;
  demands: { apartmentId: string; demandWh: number }[];
};

/**
 * Seeded, deterministic source of simulated readings for one building. Solar
 * comes from the irradiance passed in (real weather, ADR-008), or from the
 * clear-sky curve when that is null. Demand is simulated from the site's local
 * hour. The same seed, apartments, intervals and weather input always give the
 * same readings. Used by the simulator and the seed's history (ADR-004).
 * Pure: no framework imports.
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
    private readonly timeZone: string,
  ) {
    this.rng = mulberry32(seed);
    this.baseByApartment = new Map(
      apartmentIds.map((id) => [id, baseDemandWh(this.rng())]),
    );
  }

  /**
   * @param irradianceWm2 mean irradiance for this interval, or null to use the
   * clear-sky fallback. The PRNG advances the same way either way, so demand
   * never depends on whether weather was available.
   */
  next(intervalStart: Date, irradianceWm2: number | null): GeneratedReading {
    const hour = localHourOfDay(intervalStart, this.timeZone);
    this.cloud = nextCloud(this.cloud, this.rng());
    return {
      deviceId: this.deviceId,
      intervalStart: intervalStart.toISOString(),
      solarWh:
        irradianceWm2 === null
          ? solarWh(this.capacityW, hour, this.cloud, INTERVAL_MINUTES)
          : solarWhFromIrradiance(
              this.capacityW,
              irradianceWm2,
              INTERVAL_MINUTES,
            ),
      demands: this.apartmentIds.map((id) => ({
        apartmentId: id,
        demandWh: demandWh(this.baseByApartment.get(id)!, hour, this.rng()),
      })),
    };
  }
}
