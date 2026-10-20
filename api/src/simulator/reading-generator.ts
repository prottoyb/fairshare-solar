import { INTERVAL_MINUTES } from '../common/limits';
import {
  localDateString,
  localDayRange,
  localHourOfDay,
} from '../common/local-time';
import { mulberry32 } from './prng';
import {
  intervalDemandWh,
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

/** A flat as the generator needs it, in a stable order (by label). */
export type GeneratorApartment = { id: string; lotEntitlement: number };

/** Weather for one interval; nulls mean fallback solar and no heating/cooling. */
export type GeneratorWeather = {
  irradianceWm2: number | null;
  temperatureC: number | null;
};

/**
 * Source of simulated readings for one building. Solar comes from the
 * irradiance passed in (real weather, ADR-008), or from the clear-sky curve when
 * that is null. Demand (ADR-009) is a pure function of (seed, flat, Melbourne
 * local date, interval of the day) plus the temperature, so it never depends on
 * how many readings came before: a restart, the seed and the simulator all give
 * the same value for the same interval. Pure: no framework imports.
 */
export class ReadingGenerator {
  private readonly rng: () => number;
  private cloud = 1;

  constructor(
    private readonly seed: number,
    private readonly apartments: GeneratorApartment[],
    private readonly capacityW: number,
    private readonly deviceId: string,
    private readonly timeZone: string,
  ) {
    // Only the clear-sky fallback's cloud walk uses this stream.
    this.rng = mulberry32(seed);
  }

  next(intervalStart: Date, weather: GeneratorWeather): GeneratedReading {
    const hour = localHourOfDay(intervalStart, this.timeZone);
    this.cloud = nextCloud(this.cloud, this.rng());

    const localDate = localDateString(intervalStart, this.timeZone);
    const dayStart = localDayRange(localDate, this.timeZone).start.getTime();
    const intervalMs = INTERVAL_MINUTES * 60_000;
    const intervalOfDay = Math.round(
      (intervalStart.getTime() - dayStart) / intervalMs,
    );
    const midpointHour = localHourOfDay(
      new Date(intervalStart.getTime() + intervalMs / 2),
      this.timeZone,
    );

    return {
      deviceId: this.deviceId,
      intervalStart: intervalStart.toISOString(),
      solarWh:
        weather.irradianceWm2 === null
          ? solarWh(this.capacityW, hour, this.cloud, INTERVAL_MINUTES)
          : solarWhFromIrradiance(
              this.capacityW,
              weather.irradianceWm2,
              INTERVAL_MINUTES,
            ),
      demands: this.apartments.map((apt, flatIndex) => ({
        apartmentId: apt.id,
        demandWh: intervalDemandWh({
          seed: this.seed,
          flatIndex,
          lotEntitlement: apt.lotEntitlement,
          localDate,
          intervalOfDay,
          localHour: midpointHour,
          temperatureC: weather.temperatureC,
          intervalMinutes: INTERVAL_MINUTES,
        }),
      })),
    };
  }
}
