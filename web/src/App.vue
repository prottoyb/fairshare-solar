<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { api } from '@/api/client'
import ApartmentBars from '@/components/ApartmentBars.vue'
import BuildingHeader from '@/components/BuildingHeader.vue'
import DailySummary from '@/components/DailySummary.vue'
import LiveFlow from '@/components/LiveFlow.vue'
import SimulatorControls from '@/components/SimulatorControls.vue'
import SplitModeToggle from '@/components/SplitModeToggle.vue'
import WeatherCard from '@/components/WeatherCard.vue'
import { useBuilding } from '@/composables/useBuilding'
import { useLive } from '@/composables/useLive'
import { siteDateString } from '@/format'
import type { ReadingResult, SimulatorStatus } from '@/types'

const { building, loading, error, setSplitMode } = useBuilding()
const { connected, latestReading, deviceStatus, receivedCount } = useLive()

const simulator = shallowRef<SimulatorStatus | null>(null)
const storedReading = shallowRef<ReadingResult | null>(null)

// Show the latest stored interval until the live stream sends a new one.
watch(
  () => building.value?.id,
  async (id) => {
    if (!id) return
    try {
      const [latest] = await api.listReadings(id, 1)
      storedReading.value = latest ?? null
    } catch {
      // The live stream fills this in once readings arrive.
    }
  },
)

const reading = computed(() => latestReading.value ?? storedReading.value)

// The summary and weather follow the simulated clock (which runs ahead of real
// time), as a Melbourne local date.
const summaryDate = computed(() => {
  const at = reading.value?.intervalStart ?? simulator.value?.simulatedTime
  return at ? siteDateString(at) : null
})
</script>

<template>
  <div class="page">
    <p v-if="loading" class="notice">Loading building…</p>
    <p v-else-if="error" class="notice error" role="alert">{{ error }}</p>

    <template v-if="building">
      <BuildingHeader
        :name="building.name"
        :capacity-w="building.capacityW"
        :status="deviceStatus?.status ?? 'OFFLINE'"
        :last-reading-at="deviceStatus?.lastReadingAt ?? null"
        :connected="connected"
      />

      <main class="layout">
        <div class="column area-controls">
          <div class="panel">
            <SimulatorControls @status="simulator = $event" />
          </div>
          <div class="panel">
            <SplitModeToggle :model-value="building.splitMode" :save="setSplitMode" />
          </div>
        </div>
        <div class="column area-live">
          <div class="panel">
            <LiveFlow :reading="reading" />
          </div>
          <div class="panel">
            <WeatherCard :date="summaryDate" :at="reading?.intervalStart ?? null" />
          </div>
        </div>
        <div class="panel area-bars">
          <ApartmentBars :apartments="building.apartments" :reading="reading" />
        </div>
        <div class="panel area-summary">
          <DailySummary
            :building-id="building.id"
            :date="summaryDate"
            :reading-count="receivedCount"
          />
        </div>
      </main>

      <footer class="footer">
        Independent demo. Solar is estimated from real weather for Fawkner; apartment demand is
        simulated. Allocation model and figures are illustrative.
      </footer>
    </template>
  </div>
</template>

<style scoped>
.page {
  max-width: 76rem;
  margin: 0 auto;
  padding: var(--space-5) var(--space-4) var(--space-4);
}

.notice {
  color: var(--color-muted);
}

.notice.error {
  color: var(--color-error);
}

/* One column on phones; two columns on tablets; three at 1200 px+ so the
   controls, the live figures and the bars all sit above the fold at 1280×720. */
.layout {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-4);
  grid-template-areas: 'controls' 'live' 'bars' 'summary';
  align-items: start;
}

.area-controls {
  grid-area: controls;
}

.area-live {
  grid-area: live;
}

.area-bars {
  grid-area: bars;
}

.area-summary {
  grid-area: summary;
}

.column {
  display: grid;
  gap: var(--space-4);
  align-content: start;
  min-width: 0;
}

.panel {
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
}

@media (min-width: 60rem) {
  .layout {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    grid-template-areas:
      'controls bars'
      'live bars'
      'summary summary';
  }
}

@media (min-width: 75rem) {
  .layout {
    grid-template-columns: minmax(0, 4fr) minmax(0, 4fr) minmax(0, 5fr);
    grid-template-areas:
      'controls live bars'
      'summary summary summary';
  }
}

.footer {
  margin-top: var(--space-5);
  font-size: 0.8rem;
  color: var(--color-muted);
  text-align: center;
}
</style>
