import { onMounted, ref, shallowRef } from 'vue'
import { api, errorMessage } from '@/api/client'
import type { BuildingDetail, ShareInput, SplitMode } from '@/types'

/** Loads the first building (the demo has one) and changes its split mode. */
export function useBuilding() {
  const building = shallowRef<BuildingDetail | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [first] = await api.listBuildings()
      if (!first) throw new Error('No building found. Run npm.cmd run db:setup first.')
      building.value = await api.getBuilding(first.id)
    } catch (err) {
      error.value = errorMessage(err)
    } finally {
      loading.value = false
    }
  }

  /** PATCHes the split mode. Throws on failure so the caller can revert its UI. */
  async function setSplitMode(splitMode: SplitMode): Promise<void> {
    if (!building.value) throw new Error('Building not loaded yet')
    building.value = await api.patchSplitMode(building.value.id, splitMode)
  }

  /** PUTs the owner-set shares. Throws on failure so the caller can revert. */
  async function setShares(shares: ShareInput[]): Promise<void> {
    if (!building.value) throw new Error('Building not loaded yet')
    building.value = await api.putShares(building.value.id, shares)
  }

  onMounted(load)

  return { building, loading, error, reload: load, setSplitMode, setShares }
}
