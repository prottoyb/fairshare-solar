import { createHash } from 'node:crypto';

export type HashableReading = {
  deviceId: string;
  intervalStart: string | Date;
  solarWh: number;
  demands: { apartmentId: string; demandWh: number }[];
};

/**
 * sha256 hex of a canonical form of the reading, for idempotency (ADR-006).
 * The same instant in any ISO form and demands in any order give the same hash.
 */
export function payloadHash(reading: HashableReading): string {
  const canonical = JSON.stringify({
    deviceId: reading.deviceId,
    intervalStart: new Date(reading.intervalStart).toISOString(),
    solarWh: reading.solarWh,
    demands: [...reading.demands]
      .sort((a, b) =>
        a.apartmentId < b.apartmentId
          ? -1
          : a.apartmentId > b.apartmentId
            ? 1
            : 0,
      )
      .map((d) => ({ apartmentId: d.apartmentId, demandWh: d.demandWh })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}
