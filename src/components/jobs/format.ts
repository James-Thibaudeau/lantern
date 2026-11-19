import type { Salary } from '#/pipeline/schema'

export function formatSalary(s: Salary | null): string | null {
  if (!s || (s.min == null && s.max == null)) return null
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-CA', {
      style: s.currency ? 'currency' : 'decimal',
      currency: s.currency ?? undefined,
      notation: n >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: n >= 10_000 ? 0 : 2,
    }).format(n)
  const range =
    s.min != null && s.max != null && s.min !== s.max
      ? `${fmt(s.min)}–${fmt(s.max)}`
      : fmt((s.min ?? s.max)!)
  return s.period ? `${range} / ${s.period}` : range
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** "+8" or "−15" (a real minus sign). */
export const points = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)
