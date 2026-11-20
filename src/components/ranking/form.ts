import type { z } from 'zod'

import {
  ELIGIBILITY,
  ELIGIBILITY_LABEL,
  EligibilitySchema,
  type Eligibility,
} from '#/pipeline/schema'
import type { Criteria, CriteriaSchema, Scope } from '#/rank/criteria'

// The criteria editor's form state, and the pure conversions to and from Criteria. Numbers and
// phrases are kept as the raw text being typed, so "-" or a trailing comma don't vanish; they're
// converted (and validated with CriteriaSchema) on every change.

export interface SignalRow {
  /** Stable React key; never saved. */
  key: string
  label: string
  /** Comma-separated. */
  phrases: string
  weight: string
  in: Scope
}

export interface DealbreakerRow {
  key: string
  label: string
  phrases: string
  in: Scope
}

export interface SalaryForm {
  enabled: boolean
  currency: string
  floor: string
  belowFloor: string
}

export interface CriteriaForm {
  signals: SignalRow[]
  dealbreakers: DealbreakerRow[]
  /** Points per eligibility; empty means not set. */
  eligibility: Record<Eligibility, string>
  salary: SalaryForm
}

/** What CriteriaSchema accepts (before defaults and transforms). */
export type CriteriaInput = z.input<typeof CriteriaSchema>

export const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'location', label: 'Location' },
  { value: 'any', label: 'Title or description' },
]

export function parseScope(value: string): Scope {
  return SCOPE_OPTIONS.find((o) => o.value === value)?.value ?? 'any'
}

let lastKey = 0
export const newKey = () => `row-${++lastKey}`

export const newSignal = (): SignalRow => ({
  key: newKey(),
  label: 'New signal',
  phrases: '',
  weight: '5',
  in: 'any',
})

export const newDealbreaker = (): DealbreakerRow => ({
  key: newKey(),
  label: 'New dealbreaker',
  phrases: '',
  in: 'any',
})

/** "react, next.js ,, nextjs" → ["react", "next.js", "nextjs"] */
export function parsePhrases(text: string): string[] {
  return text
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/** Empty text is NaN rather than 0, so the schema reports a missing number. */
function parseNumber(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text)
}

const EMPTY_ELIGIBILITY: Record<Eligibility, string> = {
  canada_onsite: '',
  canada_hybrid: '',
  remote_canada_ok: '',
  remote_us_only: '',
  remote_non_canada: '',
  non_canada_onsite: '',
  unknown: '',
}

export function fromCriteria(c: Criteria): CriteriaForm {
  const eligibility = { ...EMPTY_ELIGIBILITY }
  for (const e of ELIGIBILITY) {
    const points = c.eligibility[e]
    if (points !== undefined) eligibility[e] = String(points)
  }
  return {
    signals: c.signals.map((s) => ({
      key: newKey(),
      label: s.label,
      phrases: s.phrases.join(', '),
      weight: String(s.weight),
      in: s.in,
    })),
    dealbreakers: c.dealbreakers.map((d) => ({
      key: newKey(),
      label: d.label,
      phrases: d.phrases.join(', '),
      in: d.in,
    })),
    eligibility,
    salary: c.salary
      ? {
          enabled: true,
          currency: c.salary.currency,
          floor: String(c.salary.floor),
          belowFloor: String(c.salary.belowFloor),
        }
      : { enabled: false, currency: '', floor: '', belowFloor: '' },
  }
}

/** The form as a criteria object, ready for CriteriaSchema.safeParse. */
export function toCriteria(form: CriteriaForm): CriteriaInput {
  const eligibility: Partial<Record<Eligibility, number>> = {}
  for (const e of ELIGIBILITY) {
    const text = form.eligibility[e]
    if (text.trim() === '') continue
    const points = Number(text)
    if (points !== 0) eligibility[e] = points
  }
  const { salary } = form
  return {
    signals: form.signals.map((s) => ({
      label: s.label.trim(),
      phrases: parsePhrases(s.phrases),
      weight: parseNumber(s.weight),
      in: s.in,
    })),
    dealbreakers: form.dealbreakers.map((d) => ({
      label: d.label.trim(),
      phrases: parsePhrases(d.phrases),
      in: d.in,
    })),
    eligibility,
    ...(salary.enabled && {
      salary: {
        currency: salary.currency.trim(),
        floor: parseNumber(salary.floor),
        belowFloor: parseNumber(salary.belowFloor),
      },
    }),
  }
}

const FIELD_NAME: Record<string, string> = {
  label: 'label',
  phrases: 'phrases',
  weight: 'points',
  in: 'look in',
  currency: 'currency',
  floor: 'floor',
  belowFloor: 'penalty',
}

function where(path: PropertyKey[], form: CriteriaForm): string {
  const [section, index, field] = path
  const fieldName = typeof field === 'string' ? (FIELD_NAME[field] ?? field) : undefined
  if ((section === 'signals' || section === 'dealbreakers') && typeof index === 'number') {
    const row = form[section][index]
    const noun = section === 'signals' ? 'Signal' : 'Dealbreaker'
    const name = row?.label.trim() ? ` “${row.label.trim()}”` : ''
    return [`${noun} ${index + 1}${name}`, fieldName].filter(Boolean).join(', ')
  }
  if (section === 'eligibility' && typeof index === 'string') {
    const e = EligibilitySchema.safeParse(index).data
    return `Location points, ${e ? ELIGIBILITY_LABEL[e] : index}`
  }
  if (section === 'salary') {
    const name = typeof index === 'string' ? (FIELD_NAME[index] ?? index) : undefined
    return ['Salary floor', name].filter(Boolean).join(', ')
  }
  return path.map(String).join('.') || 'Criteria'
}

function what(issue: z.ZodError['issues'][number]): string {
  const field = issue.path.at(-1)
  if (issue.code === 'invalid_type' && issue.expected === 'number') return 'enter a number'
  if (field === 'phrases') return 'add at least one phrase (separate them with commas)'
  if (field === 'label') return 'needs a label'
  if (field === 'currency') return 'use a 3-letter code, like CAD'
  if (field === 'floor' && issue.code === 'too_small') return 'must be more than 0'
  if (field === 'belowFloor' && issue.code === 'too_big') return 'must be 0 or less'
  return issue.message
}

/** Readable validation messages, e.g. "Signal 2 “React”, phrases: add at least one phrase". */
export function describeIssues(error: z.ZodError, form: CriteriaForm): string[] {
  return error.issues.map((i) => `${where(i.path, form)}: ${what(i)}`)
}
