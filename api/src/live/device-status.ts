/** Device status rules (brief §6.3). Pure: no framework imports. */

export type DeviceStatus = 'OFFLINE' | 'ONLINE' | 'STALE';

/** Payload of the `device-status` WebSocket event (brief §5.8). */
export type DeviceStatusEvent = {
  buildingId: string;
  deviceId: string;
  status: DeviceStatus;
  lastReadingAt: string | null;
};

/**
 * OFFLINE: no reading since the server started. STALE: the last reading is at
 * least `thresholdMs` old (3 missed intervals). ONLINE otherwise.
 */
export function computeStatus(
  lastReadingAt: number | null,
  now: number,
  thresholdMs: number,
): DeviceStatus {
  if (lastReadingAt === null) return 'OFFLINE';
  return now - lastReadingAt >= thresholdMs ? 'STALE' : 'ONLINE';
}

/** Missed intervals before a device counts as stale. */
export const STALE_AFTER_INTERVALS = 3;
