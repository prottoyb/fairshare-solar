<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { api, errorMessage } from '@/api/client'
import { formatPct, formatUtcDate, formatWh } from '@/format'
import type { DailySummary } from '@/types'

const props = defineProps<{
  buildingId: string
  /** Simulated UTC date (YYYY-MM-DD), not the browser's date. */
  date: string | null
  /** Readings received so far; the summary refetches every 10. */
  readingCount: number
}>()

const REFRESH_EVERY = 10

const summary = shallowRef<DailySummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  if (!props.date) return
  loading.value = true
  error.value = null
  try {
    summary.value = await api.summary(props.buildingId, props.date)
  } catch (err) {
    error.value = `Couldn’t load the summary: ${errorMessage(err)}`
  } finally {
    loading.value = false
  }
}

watch(() => [props.buildingId, props.date], load, { immediate: true })
watch(
  () => props.readingCount,
  (count) => {
    if (count > 0 && count % REFRESH_EVERY === 0) void load()
  },
)
</script>

<template>
  <section class="daily-summary" aria-labelledby="summary-heading">
    <div class="heading-row">
      <h2 id="summary-heading">Daily summary</h2>
      <button type="button" class="secondary" :disabled="loading || !date" @click="load">
        {{ loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </div>

    <p v-if="!date" class="empty">No simulated day yet. Start the simulator.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="summary">
      <dl class="totals">
        <div>
          <dt>Intervals</dt>
          <dd>{{ summary.building.intervals }} / 288</dd>
        </div>
        <div>
          <dt>Solar</dt>
          <dd>{{ formatWh(summary.building.solarWh) }}</dd>
        </div>
        <div>
          <dt>Shared</dt>
          <dd>{{ formatWh(summary.building.allocatedWh) }}</dd>
        </div>
        <div>
          <dt>Exported</dt>
          <dd>{{ formatWh(summary.building.exportedWh) }}</dd>
        </div>
        <div>
          <dt>Solar used on site</dt>
          <dd>{{ formatPct(summary.building.solarUsedPct) }}</dd>
        </div>
      </dl>

      <div class="table-wrap">
        <table>
          <caption>
            Per apartment for
            {{
              formatUtcDate(summary.date)
            }}
            (UTC, simulated day)
          </caption>
          <thead>
            <tr>
              <th scope="col">Apartment</th>
              <th scope="col" class="num">Entitlement</th>
              <th scope="col" class="num">Demand</th>
              <th scope="col" class="num">Solar allocated</th>
              <th scope="col" class="num">Self-sufficiency</th>
              <th scope="col" class="num">Share of solar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="apt in summary.apartments" :key="apt.apartmentId">
              <th scope="row">{{ apt.label }}</th>
              <td class="num">{{ apt.lotEntitlement }}</td>
              <td class="num">{{ formatWh(apt.demandWh) }}</td>
              <td class="num">{{ formatWh(apt.allocatedWh) }}</td>
              <td class="num">{{ formatPct(apt.selfSufficiencyPct) }}</td>
              <td class="num">{{ formatPct(apt.shareOfSolarPct) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.empty {
  color: var(--color-muted);
}

.error {
  color: var(--color-error);
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--space-2);
  margin: var(--space-3) 0;
}

.totals div {
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}

dt {
  font-size: 0.8rem;
  color: var(--color-muted);
}

dd {
  margin: 0.1rem 0 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

caption {
  text-align: left;
  padding-bottom: var(--space-2);
  color: var(--color-muted);
  font-size: 0.875rem;
}

th,
td {
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  white-space: nowrap;
}

thead th {
  font-size: 0.8rem;
  color: var(--color-muted);
  font-weight: 600;
}

.num {
  text-align: right;
}
</style>
