<script setup lang="ts">
import { computed } from 'vue'
import { formatLocalTime } from '@/format'
import type { DeviceStatus } from '@/types'

const props = defineProps<{
  name: string
  capacityW: number
  status: DeviceStatus
  lastReadingAt: string | null
  connected: boolean
}>()

const statusText: Record<DeviceStatus, string> = {
  ONLINE: 'Online',
  STALE: 'Stale',
  OFFLINE: 'Offline',
}

const capacityKw = computed(() => (props.capacityW / 1000).toLocaleString('en-AU'))

const statusTitle = computed(() =>
  props.lastReadingAt
    ? `Last reading received at ${formatLocalTime(props.lastReadingAt)}`
    : 'No reading since the server started',
)
</script>

<template>
  <header class="building-header">
    <div class="title">
      <p class="eyebrow">FairShare Solar</p>
      <h1>{{ name }}</h1>
      <p class="meta">Shared rooftop solar · {{ capacityKw }} kW system</p>
    </div>
    <div class="status-area">
      <span v-if="!connected" class="reconnecting" role="status">Reconnecting…</span>
      <span
        class="status-pill"
        :class="`status-${status.toLowerCase()}`"
        :title="statusTitle"
        data-testid="device-status"
        role="status"
        tabindex="0"
        :aria-label="`Device status: ${statusText[status]}. ${statusTitle}`"
      >
        <span class="dot" aria-hidden="true"></span>{{ statusText[status] }}
      </span>
    </div>
  </header>
</template>

<style scoped>
.building-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.eyebrow {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-solar-text);
}

h1 {
  margin: 0.15rem 0 0;
  font-size: clamp(1.5rem, 3vw, 2rem);
  line-height: 1.15;
}

.meta {
  margin: 0.25rem 0 0;
  color: var(--color-muted);
}

.status-area {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.reconnecting {
  font-size: 0.875rem;
  color: var(--color-warn);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  border: 1px solid currentColor;
  font-weight: 600;
  background: var(--color-surface);
  cursor: help;
}

.dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: currentColor;
}

.status-online {
  color: var(--color-ok);
}

.status-stale {
  color: var(--color-warn);
}

.status-offline {
  color: var(--color-off);
}
</style>
