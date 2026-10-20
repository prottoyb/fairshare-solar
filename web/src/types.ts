// API shapes, duplicated from the NestJS app on purpose (ADR-005).

export type SplitMode = 'EQUAL' | 'ENTITLEMENT'

export type BuildingSummary = {
  id: string
  name: string
  splitMode: SplitMode
  capacityW: number
}

export type Apartment = {
  id: string
  label: string
  lotEntitlement: number
}

export type BuildingDetail = BuildingSummary & {
  intervalMinutes: number
  apartments: Apartment[]
}

export type AllocationItem = {
  apartmentId: string
  label: string
  lotEntitlement: number
  demandWh: number
  allocatedWh: number
}

/** Ingest response, readings list item and the `reading` WebSocket event. */
export type ReadingResult = {
  readingId: string
  buildingId: string
  intervalStart: string
  solarWh: number
  exportedWh: number
  splitModeUsed: SplitMode
  replayed: boolean
  allocations: AllocationItem[]
}

export type DeviceStatus = 'OFFLINE' | 'ONLINE' | 'STALE'

/** The `device-status` WebSocket event. */
export type DeviceStatusEvent = {
  buildingId: string
  deviceId: string
  status: DeviceStatus
  lastReadingAt: string | null
}

export type DailySummary = {
  date: string
  building: {
    intervals: number
    solarWh: number
    allocatedWh: number
    exportedWh: number
    demandWh: number
    solarUsedPct: number
  }
  apartments: {
    apartmentId: string
    label: string
    lotEntitlement: number
    demandWh: number
    allocatedWh: number
    selfSufficiencyPct: number
    shareOfSolarPct: number
  }[]
}

export type SimulatorStatus = {
  running: boolean
  speedMs: number
  buildingId: string | null
  simulatedTime: string | null
}

/** `GET /api/weather?date=` for a Melbourne local date (ADR-008). */
export type WeatherDay = {
  date: string
  location: { name: string; latitude: number; longitude: number; timezone: string }
  source: 'open-meteo' | 'fallback'
  sunrise: string | null
  sunset: string | null
  daylightHours: number | null
  sunshineHours: number | null
  /** Hour means over [start, end). */
  hourly: { start: string; end: string; irradianceWm2: number; cloudCoverPct: number }[]
}
