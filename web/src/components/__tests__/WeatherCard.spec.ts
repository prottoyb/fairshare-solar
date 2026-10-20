import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import WeatherCard from '../WeatherCard.vue'
import type { WeatherDay } from '@/types'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const location = {
  name: 'Fawkner VIC 3060',
  latitude: -37.707,
  longitude: 144.968,
  timezone: 'Australia/Melbourne',
}

// Values from the saved Open-Meteo response for 20 October 2026 (AEDT, UTC+11).
const day: WeatherDay = {
  date: '2026-10-20',
  location,
  source: 'open-meteo',
  sunrise: '2026-10-19T19:28:40.000Z',
  sunset: '2026-10-20T08:41:50.000Z',
  daylightHours: 13.2,
  sunshineHours: 10.8,
  hourly: [
    {
      start: '2026-10-20T00:00:00.000Z', // 11:00–12:00 local
      end: '2026-10-20T01:00:00.000Z',
      irradianceWm2: 716,
      cloudCoverPct: 30,
    },
    {
      start: '2026-10-20T01:00:00.000Z', // 12:00–13:00 local
      end: '2026-10-20T02:00:00.000Z',
      irradianceWm2: 877,
      cloudCoverPct: 52,
    },
  ],
}

describe('WeatherCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows sun times in Melbourne time, sunshine, this hour and the attribution', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, day))
    vi.stubGlobal('fetch', fetchMock)

    // An interval at 12:35 local falls in the 12:00–13:00 hour.
    const wrapper = mount(WeatherCard, {
      props: { date: '2026-10-20', at: '2026-10-20T01:35:00.000Z' },
    })
    await flushPromises()

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/weather?date=2026-10-20')
    expect(wrapper.get('h2').text()).toBe('Weather in Fawkner')
    const text = wrapper.text()
    expect(text).toContain('06:28 AEDT') // sunrise
    expect(text).toContain('19:41 AEDT') // sunset
    expect(text).toContain('Sunshine 10.8 h of 13.2 h daylight')
    expect(text).toContain('52 %')
    expect(text).toContain('877 W/m²')

    const links = wrapper.findAll('.attribution a')
    expect(wrapper.get('.attribution').text()).toBe('Weather data: Open-Meteo.com (CC BY 4.0)')
    expect(links.map((a) => a.attributes('href'))).toEqual([
      'https://open-meteo.com/',
      'https://creativecommons.org/licenses/by/4.0/',
    ])
  })

  it('follows the interval to the matching hour', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, day)))
    const wrapper = mount(WeatherCard, {
      props: { date: '2026-10-20', at: '2026-10-20T00:10:00.000Z' }, // 11:10 local
    })
    await flushPromises()
    expect(wrapper.text()).toContain('716 W/m²')
    await wrapper.setProps({ at: '2026-10-20T01:00:00.000Z' }) // 12:00 local
    expect(wrapper.text()).toContain('877 W/m²')
  })

  it('says so when the weather source fell back to the clear-sky estimate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(200, {
          ...day,
          date: '2026-12-01',
          source: 'fallback',
          sunrise: null,
          sunset: null,
          daylightHours: null,
          sunshineHours: null,
          hourly: [],
        }),
      ),
    )
    const wrapper = mount(WeatherCard, { props: { date: '2026-12-01', at: null } })
    await flushPromises()
    expect(wrapper.get('[data-testid="weather-fallback"]').text()).toContain(
      'Solar uses a clear-sky estimate',
    )
    expect(wrapper.text()).toContain('Open-Meteo.com') // attribution still shown
  })

  it('shows an alert when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    const wrapper = mount(WeatherCard, { props: { date: '2026-10-20', at: null } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Failed to fetch')
  })
})
