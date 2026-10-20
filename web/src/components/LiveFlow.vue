<script setup lang="ts">
import { computed } from 'vue'
import { formatSiteDate, formatSiteTime, formatWh } from '@/format'
import type { ReadingResult } from '@/types'

const props = defineProps<{ reading: ReadingResult | null }>()

const allocatedWh = computed(
  () => props.reading?.allocations.reduce((sum, a) => sum + a.allocatedWh, 0) ?? 0,
)
</script>

<template>
  <section class="live-flow" aria-labelledby="live-heading">
    <h2 id="live-heading">This interval</h2>
    <div aria-live="polite">
      <p v-if="!reading" class="empty">Waiting for first reading…</p>
      <template v-else>
        <p class="when">
          <span class="time">{{ formatSiteTime(reading.intervalStart) }}</span>
          <span class="date">{{ formatSiteDate(reading.intervalStart) }} · simulated</span>
        </p>
        <dl class="figures">
          <div class="figure solar">
            <dt>Solar generated</dt>
            <dd>{{ formatWh(reading.solarWh) }}</dd>
          </div>
          <div class="figure allocated">
            <dt>Shared to apartments</dt>
            <dd>{{ formatWh(allocatedWh) }}</dd>
          </div>
          <div class="figure exported">
            <dt>Exported to grid</dt>
            <dd>{{ formatWh(reading.exportedWh) }}</dd>
          </div>
          <div class="figure mode">
            <dt>Split mode used</dt>
            <dd>
              <span class="mode-pill" data-testid="live-split-mode">{{
                reading.splitModeUsed
              }}</span>
            </dd>
          </div>
        </dl>
      </template>
    </div>
  </section>
</template>

<style scoped>
.empty {
  margin: 0;
  color: var(--color-muted);
}

.when {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0 0 var(--space-3);
}

.time {
  font-size: 1.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.date {
  color: var(--color-muted);
}

.figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0;
}

.figure {
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  border-left: 4px solid var(--color-border);
}

.figure.solar,
.figure.allocated {
  border-left-color: var(--color-solar);
}

.figure.exported {
  border-left-color: var(--color-demand);
}

dt {
  font-size: 0.8rem;
  color: var(--color-muted);
}

dd {
  margin: 0.15rem 0 0;
  font-size: 1.2rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.mode-pill {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  background: var(--color-text);
  color: var(--color-surface);
}
</style>
