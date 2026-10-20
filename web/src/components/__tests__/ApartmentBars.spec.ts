import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ApartmentBars from '../ApartmentBars.vue'
import type { Apartment, ReadingResult } from '@/types'

const apartments: Apartment[] = [
  { id: 'a1', label: 'Unit 1', lotEntitlement: 10, customSharePct: 30 },
  { id: 'a2', label: 'Unit 2', lotEntitlement: 15, customSharePct: 30 },
  { id: 'a3', label: 'Unit 3', lotEntitlement: 30, customSharePct: 40 },
]

const reading: ReadingResult = {
  readingId: 'r1',
  buildingId: 'b1',
  intervalStart: '2026-10-20T03:05:00.000Z',
  solarWh: 500,
  exportedWh: 0,
  splitModeUsed: 'EQUAL',
  replayed: false,
  allocations: [
    { apartmentId: 'a1', label: 'Unit 1', lotEntitlement: 10, demandWh: 100, allocatedWh: 100 },
    { apartmentId: 'a2', label: 'Unit 2', lotEntitlement: 15, demandWh: 400, allocatedWh: 200 },
    { apartmentId: 'a3', label: 'Unit 3', lotEntitlement: 30, demandWh: 250, allocatedWh: 200 },
  ],
}

describe('ApartmentBars', () => {
  it('renders one meter per apartment with matching aria values', () => {
    const wrapper = mount(ApartmentBars, { props: { apartments, reading } })
    const meters = wrapper.findAll('[role="meter"]')

    expect(meters).toHaveLength(3)
    expect(
      meters.map((m) => ({
        min: m.attributes('aria-valuemin'),
        max: m.attributes('aria-valuemax'),
        now: m.attributes('aria-valuenow'),
      })),
    ).toEqual([
      { min: '0', max: '100', now: '100' },
      { min: '0', max: '400', now: '200' },
      { min: '0', max: '250', now: '200' },
    ])
    expect(meters[1]!.attributes('aria-label')).toBe('Unit 2: 200 of 400 Wh demand met by solar')
  })

  it('shows the numbers as visible text too', () => {
    const wrapper = mount(ApartmentBars, { props: { apartments, reading } })
    const text = wrapper.text()
    expect(text).toContain('Unit 2')
    expect(text).toContain('Entitlement 15')
    expect(text).toContain('200 Wh of 400 Wh')
  })

  it('scales bars to the largest demand and fills by the share met', () => {
    const wrapper = mount(ApartmentBars, { props: { apartments, reading } })
    // Scoped to the meters: the legend swatches share these class names.
    const demand = wrapper.findAll('[role="meter"] .demand').map((d) => d.attributes('style'))
    const fill = wrapper.findAll('[role="meter"] .allocated').map((d) => d.attributes('style'))
    expect(demand).toEqual(['width: 25%;', 'width: 100%;', 'width: 62.5%;'])
    expect(fill).toEqual(['width: 100%;', 'width: 50%;', 'width: 80%;'])
  })

  it('shows every apartment at zero before the first reading', () => {
    const wrapper = mount(ApartmentBars, { props: { apartments, reading: null } })
    const meters = wrapper.findAll('[role="meter"]')
    expect(meters).toHaveLength(3)
    for (const m of meters) {
      expect(m.attributes('aria-valuenow')).toBe('0')
      expect(m.attributes('aria-valuemax')).toBe('0')
    }
  })
})
