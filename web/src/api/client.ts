import type {
  BuildingDetail,
  BuildingSummary,
  DailySummary,
  ReadingResult,
  SimulatorStatus,
  SplitMode,
  WeatherDay,
} from '@/types'

/** A non-2xx response, with the API's own message when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Relative URLs: the Vite dev proxy forwards /api to the NestJS app.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim()
    try {
      const body = (await res.json()) as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join('; ')
      else if (body.message) message = body.message
    } catch {
      // Not JSON: keep the status line.
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

export const api = {
  listBuildings: () => request<BuildingSummary[]>('/api/buildings'),

  getBuilding: (id: string) => request<BuildingDetail>(`/api/buildings/${encodeURIComponent(id)}`),

  patchSplitMode: (id: string, splitMode: SplitMode) =>
    request<BuildingDetail>(`/api/buildings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      ...json({ splitMode }),
    }),

  listReadings: (id: string, limit = 50) =>
    request<ReadingResult[]>(`/api/buildings/${encodeURIComponent(id)}/readings?limit=${limit}`),

  summary: (id: string, date: string) =>
    request<DailySummary>(
      `/api/buildings/${encodeURIComponent(id)}/summary?date=${encodeURIComponent(date)}`,
    ),

  weather: (date: string) => request<WeatherDay>(`/api/weather?date=${encodeURIComponent(date)}`),

  simulatorStatus: () => request<SimulatorStatus>('/api/simulator/status'),

  startSimulator: (speedMs: number) =>
    request<SimulatorStatus>('/api/simulator/start', { method: 'POST', ...json({ speedMs }) }),

  stopSimulator: () =>
    request<SimulatorStatus>('/api/simulator/stop', { method: 'POST', ...json({}) }),
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
