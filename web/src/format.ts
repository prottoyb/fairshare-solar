import { SITE_TIME_ZONE } from '@/site'

const whFormat = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
const pctFormat = new Intl.NumberFormat('en-AU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const hoursFormat = new Intl.NumberFormat('en-AU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** 1840 → "1,840 Wh" */
export function formatWh(wh: number): string {
  return `${whFormat.format(wh)} Wh`
}

/** 83.3 → "83.3 %" */
export function formatPct(pct: number): string {
  return `${pctFormat.format(pct)} %`
}

/** 10.8 → "10.8 h" */
export function formatHours(hours: number): string {
  return `${hoursFormat.format(hours)} h`
}

const siteTime = new Intl.DateTimeFormat('en-AU', {
  timeZone: SITE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
})
const siteTimeWithSeconds = new Intl.DateTimeFormat('en-AU', {
  timeZone: SITE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
})
const siteDate = new Intl.DateTimeFormat('en-AU', {
  timeZone: SITE_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const siteDateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: SITE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Site local time with the zone: "06:30 AEDT" (or AEST in winter). */
export function formatSiteTime(iso: string, withSeconds = false): string {
  return (withSeconds ? siteTimeWithSeconds : siteTime).format(new Date(iso))
}

/** Site local calendar date of an instant: "Tue 20 Oct 2026". */
export function formatSiteDate(iso: string): string {
  return siteDate.format(new Date(iso))
}

/** Site local date of an instant as `YYYY-MM-DD` (the simulated day). */
export function siteDateString(iso: string): string {
  return siteDateParts.format(new Date(iso))
}

/** A date-only `YYYY-MM-DD` as a label: "Tue 20 Oct 2026". */
export function formatDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
