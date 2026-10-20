import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import OwnerSettings from '../OwnerSettings.vue'
import { api } from '@/api/client'
import type { Apartment, ShareInput } from '@/types'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const apartments: Apartment[] = [10, 10, 15, 15, 20, 30].map((lotEntitlement, i) => ({
  id: `a${i + 1}`,
  label: `Unit ${i + 1}`,
  lotEntitlement,
  customSharePct: [15, 15, 15, 15, 20, 20][i]!,
}))

function mountPanel() {
  return mount(OwnerSettings, {
    props: {
      apartments,
      // The real client, so the test sees the actual PUT request.
      save: (shares: ShareInput[]) => api.putShares('b1', shares),
    },
  })
}

type Wrapper = ReturnType<typeof mountPanel>
const input = (w: Wrapper, unit: number) =>
  w.get<HTMLInputElement>(`[data-testid="share-Unit ${unit}"]`)
const save = (w: Wrapper) => w.get<HTMLButtonElement>('[data-testid="share-save"]')
const total = (w: Wrapper) => w.get('[data-testid="share-total"]').text()

describe('OwnerSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is a labelled disclosure with one labelled % input per unit', () => {
    const w = mountPanel()
    expect(w.get('summary').text()).toBe('Building owner settings')
    expect(w.get('legend').text()).toBe('Owner-set shares')
    for (const apt of apartments) {
      const field = w.get<HTMLInputElement>(`#share-${apt.id}`)
      expect(w.get(`label[for="share-${apt.id}"]`).text()).toContain(apt.label)
      expect(field.element.value).toBe(String(apt.customSharePct))
    }
    expect(total(w)).toBe('Total 100 %')
    expect(save(w).element.disabled).toBe(false)
  })

  it('disables Save unless the total is exactly 100', async () => {
    const w = mountPanel()
    await input(w, 1).setValue(20) // 105
    expect(total(w)).toContain('Total 105 %')
    expect(total(w)).toContain('must be exactly 100 %')
    expect(save(w).element.disabled).toBe(true)

    await input(w, 6).setValue(10) // 95
    expect(total(w)).toContain('Total 95 %')
    expect(save(w).element.disabled).toBe(true)

    await input(w, 6).setValue(15) // 100
    expect(total(w)).toBe('Total 100 %')
    expect(save(w).element.disabled).toBe(false)
  })

  it('disables Save for an empty or out-of-range share even if the total is 100', async () => {
    const w = mountPanel()
    await input(w, 1).setValue(0)
    await input(w, 2).setValue(30) // 0 + 30 + 15 + 15 + 20 + 20 = 100
    expect(total(w)).toContain('Total 100 %')
    expect(save(w).element.disabled).toBe(true)
  })

  it('PUTs the shares and says when they apply', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const w = mountPanel()
    await input(w, 1).setValue(20)
    await input(w, 6).setValue(15)
    await w.get('form').trigger('submit')
    await flushPromises()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/buildings/b1/shares')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      shares: apartments.map((a, i) => ({
        apartmentId: a.id,
        sharePct: [20, 15, 15, 15, 20, 15][i],
      })),
    })
    expect(w.text()).toContain('Applies from the next interval')
  })

  it('reverts the inputs and shows the error when the PUT fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(400, { statusCode: 400, message: 'shares must total exactly 100 %' }),
        ),
    )
    const w = mountPanel()
    await input(w, 1).setValue(20)
    await input(w, 6).setValue(15)
    await w.get('form').trigger('submit')
    await flushPromises()

    expect(input(w, 1).element.value).toBe('15')
    expect(input(w, 6).element.value).toBe('20')
    expect(total(w)).toBe('Total 100 %')
    expect(w.get('[role="alert"]').text()).toContain('shares must total exactly 100 %')
    expect(w.text()).not.toContain('Applies from the next interval')
  })
})
