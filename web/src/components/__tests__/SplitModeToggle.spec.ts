import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SplitModeToggle from '../SplitModeToggle.vue'
import { api } from '@/api/client'
import type { SplitMode } from '@/types'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mountToggle(modelValue: SplitMode = 'EQUAL') {
  return mount(SplitModeToggle, {
    props: {
      modelValue,
      // The real client, so the test sees the actual PATCH request.
      save: (mode: SplitMode) => api.patchSplitMode('b1', mode),
    },
  })
}

const radio = (wrapper: ReturnType<typeof mountToggle>, testid: string) =>
  wrapper.get<HTMLInputElement>(`[data-testid="${testid}"]`)

describe('SplitModeToggle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses real radios in a fieldset with a legend', () => {
    const wrapper = mountToggle()
    expect(wrapper.find('fieldset legend').text()).toBe('Split mode')
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(3)
    expect(radio(wrapper, 'split-equal').element.checked).toBe(true)
    // The third mode (ADR-010), labelled for people, CUSTOM for the API.
    const custom = radio(wrapper, 'split-custom')
    expect(custom.element.value).toBe('CUSTOM')
    expect(custom.element.closest('label')?.textContent).toContain('Owner-set shares')
  })

  it('PATCHes CUSTOM when Owner-set shares is chosen', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { splitMode: 'CUSTOM' }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountToggle()

    await radio(wrapper, 'split-custom').setValue(true)
    await flushPromises()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ splitMode: 'CUSTOM' })
    expect(wrapper.text()).toContain('Applies from the next interval')
  })

  it('PATCHes the new mode and says when it applies', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { splitMode: 'ENTITLEMENT' }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountToggle()

    await radio(wrapper, 'split-entitlement').setValue(true)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(url).toBe('/api/buildings/b1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ splitMode: 'ENTITLEMENT' })
    expect(wrapper.text()).toContain('Applies from the next interval')
    expect(radio(wrapper, 'split-entitlement').element.checked).toBe(true)
  })

  it('reverts the selection and shows the error when the PATCH fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(500, { statusCode: 500, message: 'Database unavailable' })),
    )
    const wrapper = mountToggle()

    await radio(wrapper, 'split-entitlement').setValue(true)
    await flushPromises()

    expect(radio(wrapper, 'split-equal').element.checked).toBe(true)
    expect(radio(wrapper, 'split-entitlement').element.checked).toBe(false)
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Database unavailable')
    expect(wrapper.text()).not.toContain('Applies from the next interval')
  })

  it('reverts when the network itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    const wrapper = mountToggle()

    await radio(wrapper, 'split-entitlement').setValue(true)
    await flushPromises()

    expect(radio(wrapper, 'split-equal').element.checked).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain('Failed to fetch')
  })

  it('follows a new modelValue from the parent', async () => {
    const wrapper = mountToggle('EQUAL')
    await wrapper.setProps({ modelValue: 'ENTITLEMENT' })
    expect(radio(wrapper, 'split-entitlement').element.checked).toBe(true)
  })
})
