import { io } from 'socket.io-client'
import { onUnmounted, ref, shallowRef } from 'vue'
import type { DeviceStatusEvent, ReadingResult } from '@/types'

const RECENT_LIMIT = 50

/**
 * The live stream: one Socket.IO connection, opened by the component that calls
 * this (App) and closed when it unmounts. `io()` with no URL connects to the page's
 * own origin; the Vite proxy forwards /socket.io to the API.
 */
export function useLive() {
  const connected = ref(false)
  const latestReading = shallowRef<ReadingResult | null>(null)
  const deviceStatus = shallowRef<DeviceStatusEvent | null>(null)
  const recentReadings = shallowRef<ReadingResult[]>([])
  /** Readings received since the page loaded; drives the summary refresh. */
  const receivedCount = ref(0)

  const socket = io()

  socket.on('connect', () => {
    connected.value = true
  })
  socket.on('disconnect', () => {
    connected.value = false
  })
  socket.on('reading', (reading: ReadingResult) => {
    latestReading.value = reading
    // Ring buffer of the most recent readings, newest last.
    recentReadings.value = [...recentReadings.value, reading].slice(-RECENT_LIMIT)
    receivedCount.value++
  })
  socket.on('device-status', (status: DeviceStatusEvent) => {
    deviceStatus.value = status
  })

  onUnmounted(() => {
    socket.disconnect()
  })

  return { connected, latestReading, deviceStatus, recentReadings, receivedCount }
}
