<script setup lang="ts">
import { onMounted, ref } from 'vue'

type Health = { status: string; db: string }

const health = ref<Health | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    health.value = (await res.json()) as Health
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})
</script>

<template>
  <main class="shell">
    <h1>FairShare Solar</h1>
    <p data-testid="api-health" aria-live="polite">
      <template v-if="health">API: {{ health.status }} · database: {{ health.db }}</template>
      <template v-else-if="error">API unreachable ({{ error }})</template>
      <template v-else>Checking API…</template>
    </p>
  </main>
</template>

<style scoped>
.shell {
  max-width: 72rem;
  margin: 0 auto;
  padding: calc(var(--space) * 2) var(--space);
}
</style>
