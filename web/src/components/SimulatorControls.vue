<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, errorMessage } from '@/api/client'
import type { SimulatorStatus } from '@/types'

const emit = defineEmits<{ status: [status: SimulatorStatus] }>()

const speeds = [
  { ms: 1000, label: '1 s' },
  { ms: 2000, label: '2 s' },
  { ms: 5000, label: '5 s' },
]

const status = ref<SimulatorStatus | null>(null)
const speedMs = ref(2000)
const busy = ref(false)
const error = ref<string | null>(null)

const running = computed(() => status.value?.running ?? false)

async function run(action: () => Promise<SimulatorStatus>): Promise<void> {
  busy.value = true
  error.value = null
  try {
    status.value = await action()
    emit('status', status.value)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}

onMounted(() =>
  run(async () => {
    const current = await api.simulatorStatus()
    speedMs.value = current.speedMs
    return current
  }),
)

const start = () => run(() => api.startSimulator(speedMs.value))
const stop = () => run(() => api.stopSimulator())

/** Changing speed while running restarts the timer at the new speed. */
function onSpeedChange(): void {
  if (running.value) void start()
}
</script>

<template>
  <section class="simulator-controls" aria-labelledby="sim-heading">
    <h2 id="sim-heading">Simulator</h2>
    <div class="buttons">
      <button type="button" data-testid="sim-start" :disabled="busy || running" @click="start">
        Start simulator
      </button>
      <button
        type="button"
        class="secondary"
        data-testid="sim-stop"
        :disabled="busy || !running"
        @click="stop"
      >
        Stop simulator
      </button>
      <label class="speed">
        <span>Speed</span>
        <select v-model.number="speedMs" :disabled="busy" @change="onSpeedChange">
          <option v-for="s in speeds" :key="s.ms" :value="s.ms">{{ s.label }} per interval</option>
        </select>
      </label>
    </div>
    <p class="state" aria-live="polite">
      {{ running ? `Running: one 5-minute interval every ${speedMs / 1000} s` : 'Stopped.' }}
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.speed {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.state {
  margin: var(--space-2) 0 0;
  font-size: 0.875rem;
  color: var(--color-muted);
}

.error {
  margin: var(--space-2) 0 0;
  color: var(--color-error);
}
</style>
