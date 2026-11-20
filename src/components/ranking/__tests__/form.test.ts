import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CriteriaSchema, parseCriteria } from '#/rank/criteria'

import { describeIssues, fromCriteria, newSignal, parsePhrases, toCriteria } from '../form'

const example = parseCriteria(
  'criteria.example.json',
  readFileSync(join(process.cwd(), 'runner-template/config/criteria.example.json'), 'utf8'),
)

describe('parsePhrases', () => {
  it('splits on commas, trims and drops empties', () => {
    expect(parsePhrases(' react, next.js ,, nextjs, ')).toEqual(['react', 'next.js', 'nextjs'])
    expect(parsePhrases('  ')).toEqual([])
  })
})

describe('toCriteria', () => {
  it('round-trips the example criteria (dropping its 0 points, which score nothing)', () => {
    const back = CriteriaSchema.parse(toCriteria(fromCriteria(example)))
    const { canada_onsite: zero, ...eligibility } = example.eligibility
    expect(zero).toBe(0)
    expect(back).toEqual({ ...example, eligibility })
  })

  it('omits empty and zero location points', () => {
    const form = fromCriteria(example)
    form.eligibility.remote_canada_ok = ''
    form.eligibility.canada_hybrid = '0'
    form.eligibility.remote_us_only = '-5'
    const { eligibility } = CriteriaSchema.parse(toCriteria(form))
    expect(eligibility).toEqual({ unknown: 2, remote_us_only: -5 })
    expect(Object.keys(eligibility)).not.toContain('canada_onsite') // 0 in the example
  })

  it('omits salary when the floor is off, and uppercases the currency when on', () => {
    const form = fromCriteria(example)
    form.salary.enabled = false
    expect(toCriteria(form)).not.toHaveProperty('salary')
    form.salary = { enabled: true, currency: 'usd', floor: '120000', belowFloor: '-10' }
    expect(CriteriaSchema.parse(toCriteria(form)).salary).toEqual({
      currency: 'USD',
      floor: 120000,
      belowFloor: -10,
    })
  })

  it('reports a new signal without phrases and an empty weight readably', () => {
    const form = fromCriteria(example)
    form.signals.push({ ...newSignal(), weight: '' })
    const parsed = CriteriaSchema.safeParse(toCriteria(form))
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(describeIssues(parsed.error, form)).toEqual([
      'Signal 8 “New signal”, phrases: add at least one phrase (separate them with commas)',
      'Signal 8 “New signal”, points: enter a number',
    ])
  })
})
