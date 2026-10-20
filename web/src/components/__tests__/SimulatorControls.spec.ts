import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SimulatorControls from '../SimulatorControls.vue'
import type { SimulatorStatus } from '@/types'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const status = (running: boolean, speedMs = 2000): SimulatorStatus => ({
  running,
  speedMs,
  buildingId: 'b1',
  simulatedTime: '2026-10-21T06:25:00.000Z',
})

/** fetch that answers GET /api/simulator/status with whatever `current` holds. */
function fakeServer(initial: SimulatorStatus) {
  let current = initial
  const fetchMock = vi.fn<typeof fetch>((input) => {
    expect(String(input)).toBe('/api/simulator/status')
    return Promise.resolve(jsonResponse(current))
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    set(next: SimulatorStatus) {
      current = next
    },
  }
}

const stateText = (w: ReturnType<typeof mount>) => w.get('.state').text()

describe('SimulatorControls status sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('re-fetches when the live device status changes, following starts and stops made elsewhere', async () => {
    const server = fakeServer(status(false))
    const w = mount(SimulatorControls, { props: { deviceStatus: 'OFFLINE', connected: true } })
    await flushPromises()
    expect(stateText(w)).toBe('Stopped.')

    // Started in another tab at 1 s: the device goes ONLINE.
    server.set(status(true, 1000))
    await w.setProps({ deviceStatus: 'ONLINE' })
    await flushPromises()
    expect(server.fetchMock).toHaveBeenCalledTimes(2)
    expect(stateText(w)).toBe('Running: one 5-minute interval every 1 s')
    expect(w.get<HTMLButtonElement>('[data-testid="sim-start"]').element.disabled).toBe(true)
    expect(w.get<HTMLButtonElement>('[data-testid="sim-stop"]').element.disabled).toBe(false)

    // Stopped through the API: a few seconds later the device goes STALE.
    server.set(status(false, 1000))
    await w.setProps({ deviceStatus: 'STALE' })
    await flushPromises()
    expect(server.fetchMock).toHaveBeenCalledTimes(3)
    expect(stateText(w)).toBe('Stopped.')
    expect(w.get<HTMLButtonElement>('[data-testid="sim-start"]').element.disabled).toBe(false)
  })

  it('re-fetches when the socket reconnects', async () => {
    const server = fakeServer(status(false))
    const w = mount(SimulatorControls, { props: { deviceStatus: 'ONLINE', connected: true } })
    await flushPromises()

    await w.setProps({ connected: false })
    server.set(status(true))
    await w.setProps({ connected: true })
    await flushPromises()

    expect(server.fetchMock).toHaveBeenCalledTimes(2) // mount + reconnect only
    expect(stateText(w)).toBe('Running: one 5-minute interval every 2 s')
  })
})
