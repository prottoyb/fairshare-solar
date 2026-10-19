<script setup lang="ts">
import { computed } from 'vue'
import { formatWh } from '@/format'
import type { Apartment, ReadingResult } from '@/types'

const props = defineProps<{
  apartments: Apartment[]
  reading: ReadingResult | null
}>()

const rows = computed(() =>
  props.apartments.map((apt) => {
    const allocation = props.reading?.allocations.find((a) => a.apartmentId === apt.id)
    return {
      id: apt.id,
      label: apt.label,
      lotEntitlement: apt.lotEntitlement,
      demandWh: allocation?.demandWh ?? 0,
      allocatedWh: allocation?.allocatedWh ?? 0,
    }
  }),
)

// Bars share one scale (the largest demand this interval) so rows compare.
const scaleWh = computed(() => Math.max(1, ...rows.value.map((r) => r.demandWh)))

function widthOf(wh: number, of: number): string {
  return of > 0 ? `${Math.min(100, (wh / of) * 100)}%` : '0%'
}
</script>

<template>
  <section class="apartment-bars" aria-labelledby="bars-heading">
    <div class="heading-row">
      <h2 id="bars-heading">Apartments</h2>
      <p class="legend">
        <span class="swatch swatch-allocated" aria-hidden="true"></span>Solar allocated
        <span class="swatch swatch-demand" aria-hidden="true"></span>Demand
      </p>
    </div>
    <ul class="rows">
      <li v-for="row in rows" :key="row.id" class="row">
        <div class="row-head">
          <span class="label">{{ row.label }}</span>
          <span class="entitlement">Entitlement {{ row.lotEntitlement }}</span>
        </div>
        <div
          class="track"
          role="meter"
          aria-valuemin="0"
          :aria-valuemax="row.demandWh"
          :aria-valuenow="row.allocatedWh"
          :aria-label="`${row.label}: ${row.allocatedWh} of ${row.demandWh} Wh demand met by solar`"
        >
          <div class="demand" :style="{ width: widthOf(row.demandWh, scaleWh) }">
            <div class="allocated" :style="{ width: widthOf(row.allocatedWh, row.demandWh) }"></div>
          </div>
        </div>
        <p class="numbers">
          <strong>{{ formatWh(row.allocatedWh) }}</strong> of {{ formatWh(row.demandWh) }}
        </p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.heading-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.legend {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-muted);
}

.swatch {
  flex: none;
  display: inline-block;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 3px;
}

.swatch-allocated {
  background: var(--color-solar);
}

.swatch-demand {
  margin-left: 0.6rem;
  background: var(--color-demand-tint);
  border: 2px solid var(--color-demand);
}

.rows {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.row-head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: 0.3rem;
}

.label {
  font-weight: 600;
}

.entitlement {
  font-size: 0.85rem;
  color: var(--color-muted);
}

.track {
  height: 1.1rem;
  border-radius: 6px;
  background: var(--color-bg);
}

.demand {
  height: 100%;
  min-width: 0;
  border-radius: 6px;
  background: var(--color-demand-tint);
  box-shadow: inset 0 0 0 2px var(--color-demand);
  overflow: hidden;
  transition: width 0.4s ease;
}

.allocated {
  height: 100%;
  background: var(--color-solar);
  transition: width 0.4s ease;
}

.numbers {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.numbers strong {
  color: var(--color-text);
}

@media (prefers-reduced-motion: reduce) {
  .demand,
  .allocated {
    transition: none;
  }
}
</style>
