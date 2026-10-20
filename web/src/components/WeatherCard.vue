<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { api, errorMessage } from '@/api/client'
import { formatDateLabel, formatHours, formatSiteTime } from '@/format'
import { SITE_PLACE } from '@/site'
import type { WeatherDay } from '@/types'

const props = defineProps<{
  /** Simulated Melbourne local date (YYYY-MM-DD). */
  date: string | null
  /** Start of the interval on screen; picks "this hour". */
  at: string | null
}>()

const weather = shallowRef<WeatherDay | null>(null)
const error = ref<string | null>(null)

watch(
  () => props.date,
  async (date) => {
    if (!date) return
    error.value = null
    try {
      weather.value = await api.weather(date)
    } catch (err) {
      error.value = `Couldn’t load the weather: ${errorMessage(err)}`
    }
  },
  { immediate: true },
)

// The hour mean whose window contains the interval on screen.
const thisHour = computed(() => {
  if (!props.at || !weather.value) return null
  const t = Date.parse(props.at)
  return weather.value.hourly.find((h) => Date.parse(h.start) <= t && t < Date.parse(h.end)) ?? null
})
</script>

<template>
  <section class="weather-card" aria-labelledby="weather-heading">
    <h2 id="weather-heading">Weather in {{ SITE_PLACE }}</h2>

    <p v-if="!date" class="muted">No simulated day yet.</p>
    <p v-else-if="error" class="error" role="alert">{{ error }}</p>

    <template v-else-if="weather">
      <p v-if="weather.source === 'fallback'" class="muted" data-testid="weather-fallback">
        No weather data for {{ formatDateLabel(weather.date) }}. Solar uses a clear-sky estimate.
      </p>
      <template v-else>
        <dl class="facts">
          <div>
            <dt>Sunrise</dt>
            <dd>{{ weather.sunrise ? formatSiteTime(weather.sunrise) : '—' }}</dd>
          </div>
          <div>
            <dt>Sunset</dt>
            <dd>{{ weather.sunset ? formatSiteTime(weather.sunset) : '—' }}</dd>
          </div>
        </dl>
        <p class="sunshine">
          Sunshine {{ formatHours(weather.sunshineHours ?? 0) }} of
          {{ formatHours(weather.daylightHours ?? 0) }} daylight
        </p>
        <dl v-if="thisHour" class="facts" aria-live="polite">
          <div>
            <dt>Cloud cover this hour</dt>
            <dd>{{ thisHour.cloudCoverPct }} %</dd>
          </div>
          <div>
            <dt>Sunlight this hour</dt>
            <dd>{{ Math.round(thisHour.irradianceWm2) }} W/m²</dd>
          </div>
        </dl>
      </template>
    </template>

    <p class="attribution">
      Weather data:
      <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>
      (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener"
        >CC BY 4.0</a
      >)
    </p>
  </section>
</template>

<style scoped>
.muted {
  margin: 0;
  color: var(--color-muted);
}

.error {
  margin: 0;
  color: var(--color-error);
}

.facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
}

.facts div {
  padding: 0.5rem 0.75rem;
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

.sunshine {
  margin: 0 0 var(--space-2);
}

.attribution {
  margin: var(--space-2) 0 0;
  font-size: 0.8rem;
  color: var(--color-muted);
}

.attribution a {
  color: var(--color-text);
}
</style>
