<script setup lang="ts">
import { ref, watch } from 'vue'
import { errorMessage } from '@/api/client'
import type { SplitMode } from '@/types'

const props = defineProps<{
  modelValue: SplitMode
  /** Persists the new mode; must throw if it fails. */
  save: (mode: SplitMode) => Promise<unknown>
}>()

const options: { value: SplitMode; label: string; hint: string }[] = [
  { value: 'EQUAL', label: 'Equal', hint: 'Every apartment has the same weight' },
  {
    value: 'ENTITLEMENT',
    label: 'By lot entitlement',
    hint: 'Weighted by each lot’s entitlement',
  },
  {
    value: 'CUSTOM',
    label: 'Owner-set shares',
    hint: 'Weighted by the shares the building owner sets',
  },
]

const testIds: Record<SplitMode, string> = {
  EQUAL: 'split-equal',
  ENTITLEMENT: 'split-entitlement',
  CUSTOM: 'split-custom',
}

const selected = ref<SplitMode>(props.modelValue)
const saving = ref(false)
const message = ref<string | null>(null)
const error = ref<string | null>(null)

watch(
  () => props.modelValue,
  (mode) => {
    if (!saving.value) selected.value = mode
  },
)

async function onChange(): Promise<void> {
  const previous = props.modelValue
  const next = selected.value
  if (next === previous) return
  saving.value = true
  message.value = null
  error.value = null
  try {
    await props.save(next)
    message.value = 'Applies from the next interval'
  } catch (err) {
    selected.value = previous
    error.value = `Couldn’t change the split mode: ${errorMessage(err)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <fieldset class="split-mode" :disabled="saving">
    <legend>Split mode</legend>
    <label v-for="option in options" :key="option.value" class="option">
      <input
        v-model="selected"
        type="radio"
        name="split-mode"
        :value="option.value"
        :data-testid="testIds[option.value]"
        @change="onChange"
      />
      <span>
        <span class="option-label">{{ option.label }}</span>
        <span class="option-hint">{{ option.hint }}</span>
      </span>
    </label>
    <p class="feedback" aria-live="polite">
      <span v-if="error" class="error" role="alert">{{ error }}</span>
      <span v-else-if="message" class="ok">{{ message }}</span>
    </p>
  </fieldset>
</template>

<style scoped>
.split-mode {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  /* Side by side when there is room, stacked on narrow screens. */
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: var(--space-2);
}

.feedback {
  grid-column: 1 / -1;
}

legend {
  padding: 0;
  margin-bottom: var(--space-2);
  font-size: 1rem;
  font-weight: 600;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.option:has(input:checked) {
  border-color: var(--color-solar);
  background: var(--color-solar-tint);
}

input {
  margin-top: 0.2rem;
  accent-color: var(--color-solar-text);
}

.option-label {
  display: block;
  font-weight: 600;
}

.option-hint {
  display: block;
  font-size: 0.85rem;
  color: var(--color-muted);
}

.feedback {
  min-height: 1.5em;
  margin: 0;
  font-size: 0.875rem;
}

.ok {
  color: var(--color-ok);
}

.error {
  color: var(--color-error);
}

fieldset:disabled .option {
  cursor: progress;
  opacity: 0.7;
}
</style>
