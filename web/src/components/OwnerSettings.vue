<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { errorMessage } from '@/api/client'
import type { Apartment, ShareInput } from '@/types'

const props = defineProps<{
  apartments: Apartment[]
  /** Persists the shares (PUT); must throw if it fails. */
  save: (shares: ShareInput[]) => Promise<unknown>
}>()

/** Input values by apartment id; '' while a field is empty. */
type Values = Record<string, number | ''>

const fromProps = (): Values =>
  Object.fromEntries(props.apartments.map((a) => [a.id, a.customSharePct ?? '']))

const values = ref<Values>(fromProps())
const saving = ref(false)
const message = ref<string | null>(null)
const error = ref<string | null>(null)

// Follow the building after a save elsewhere, but never while saving.
watch(
  () => props.apartments,
  () => {
    if (!saving.value) values.value = fromProps()
  },
)

const isValidShare = (v: number | '') =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100

const total = computed(() =>
  Object.values(values.value).reduce<number>(
    (s, v) => s + (typeof v === 'number' && Number.isFinite(v) ? v : 0),
    0,
  ),
)
const allValid = computed(() => Object.values(values.value).every(isValidShare))
const canSave = computed(() => !saving.value && allValid.value && total.value === 100)

function onInput(): void {
  message.value = null
  error.value = null
}

async function onSave(): Promise<void> {
  if (!canSave.value) return
  const previous = fromProps()
  const shares = props.apartments.map((a) => ({
    apartmentId: a.id,
    sharePct: values.value[a.id] as number,
  }))
  saving.value = true
  message.value = null
  error.value = null
  try {
    await props.save(shares)
    message.value = 'Applies from the next interval'
  } catch (err) {
    values.value = previous
    error.value = `Couldn’t save the shares: ${errorMessage(err)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <details class="owner-settings">
    <summary>Building owner settings</summary>
    <form @submit.prevent="onSave">
      <fieldset :disabled="saving">
        <legend>Owner-set shares</legend>
        <p class="hint">
          Used when the split mode is “Owner-set shares”. Whole percentages from 1 to 100 that add
          up to exactly 100.
        </p>
        <div class="rows">
          <div v-for="apt in apartments" :key="apt.id" class="row">
            <label :for="`share-${apt.id}`">
              {{ apt.label }}
              <span class="entitlement">entitlement {{ apt.lotEntitlement }}</span>
            </label>
            <span class="input">
              <input
                :id="`share-${apt.id}`"
                v-model.number="values[apt.id]"
                type="number"
                inputmode="numeric"
                min="1"
                max="100"
                step="1"
                required
                :aria-invalid="!isValidShare(values[apt.id] ?? '')"
                :data-testid="`share-${apt.label}`"
                @input="onInput"
              />
              <span aria-hidden="true">%</span>
            </span>
          </div>
        </div>
        <p
          class="total"
          :class="{ bad: total !== 100 || !allValid }"
          aria-live="polite"
          data-testid="share-total"
        >
          Total {{ total }} %<template v-if="total !== 100"> · must be exactly 100 %</template
          ><template v-else-if="!allValid"> · each share must be a whole number 1–100</template>
        </p>
        <button type="submit" :disabled="!canSave" data-testid="share-save">Save shares</button>
        <p class="feedback" aria-live="polite">
          <span v-if="error" class="error" role="alert">{{ error }}</span>
          <span v-else-if="message" class="ok">{{ message }}</span>
        </p>
      </fieldset>
    </form>
    <p class="note">
      This demo has no login. In a real product only the building owner, signed in, could change
      these.
    </p>
  </details>
</template>

<style scoped>
.owner-settings {
  margin-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-3);
}

summary {
  cursor: pointer;
  font-weight: 600;
}

fieldset {
  margin: var(--space-3) 0 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

legend {
  padding: 0;
  font-weight: 600;
}

.hint,
.note {
  margin: var(--space-1) 0 var(--space-2);
  font-size: 0.85rem;
  color: var(--color-muted);
}

.rows {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  gap: var(--space-2);
}

.row {
  display: grid;
  gap: 0.2rem;
}

label {
  font-weight: 600;
}

.entitlement {
  display: block;
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--color-muted);
}

.input {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

input {
  font: inherit;
  width: 5rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-muted);
  font-variant-numeric: tabular-nums;
}

input[aria-invalid='true'] {
  border-color: var(--color-error);
}

.total {
  margin: var(--space-3) 0 var(--space-2);
  font-weight: 600;
  color: var(--color-ok);
}

.total.bad {
  color: var(--color-error);
}

.feedback {
  min-height: 1.5em;
  margin: var(--space-2) 0 0;
  font-size: 0.875rem;
}

.ok {
  color: var(--color-ok);
}

.error {
  color: var(--color-error);
}
</style>
