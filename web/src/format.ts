const whFormat = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
const pctFormat = new Intl.NumberFormat('en-AU', {
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

/** Simulated time is UTC by design: "03:05 UTC". */
export function formatUtcTime(iso: string): string {
  return `${iso.slice(11, 16)} UTC`
}

/** "2026-10-20" → "Tue 20 Oct 2026" (the UTC calendar date). */
export function formatUtcDate(isoOrDate: string): string {
  const d = new Date(`${isoOrDate.slice(0, 10)}T00:00:00Z`)
  return d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Wall-clock time in the viewer's zone, for "last reading" tooltips. */
export function formatLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour12: false })
}
