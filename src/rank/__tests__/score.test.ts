import { describe, expect, it } from 'vitest'

import { CriteriaSchema, parseCriteria, type Criteria } from '../criteria'
import { compareScores, createScorer, type ScorableJob } from '../score'

const criteria = (c: Partial<Criteria>): Criteria => CriteriaSchema.parse(c)

const job = (over: Partial<ScorableJob> = {}): ScorableJob => ({
  title: 'Software Engineer',
  descriptionText: '',
  locationText: 'Remote, Canada',
  eligibility: 'remote_canada_ok',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  ...over,
})

describe('createScorer', () => {
  it('adds a signal once however many of its phrases match', () => {
    const score = createScorer(
      criteria({
        signals: [{ label: 'React', phrases: ['react', 'next.js'], weight: 8, in: 'any' }],
      }),
    )
    const s = score(job({ title: 'React Engineer', descriptionText: 'React and Next.js, React.' }))
    expect(s).toEqual({ score: 8, reasons: [{ label: 'React', points: 8 }], dealbreaker: null })
  })

  it('limits a signal to the title or the description', () => {
    const score = createScorer(
      criteria({
        signals: [
          { label: 'Frontend title', phrases: ['frontend'], weight: 10, in: 'title' },
          { label: 'GraphQL', phrases: ['graphql'], weight: 3, in: 'description' },
        ],
      }),
    )
    expect(score(job({ descriptionText: 'Frontend work with GraphQL' })).score).toBe(3)
    expect(score(job({ title: 'Frontend Engineer, GraphQL' })).score).toBe(10)
  })

  it('matches location phrases only against the location', () => {
    const score = createScorer(
      criteria({ signals: [{ label: 'Ottawa', phrases: ['ottawa'], weight: 8, in: 'location' }] }),
    )
    expect(score(job({ locationText: 'Ottawa, ON (Hybrid)' })).score).toBe(8)
    expect(score(job({ title: 'Engineer, Ottawa team', descriptionText: 'Ottawa' })).score).toBe(0)
  })

  it('matches whole words only', () => {
    const score = createScorer(
      criteria({ signals: [{ label: 'React', phrases: ['react'], weight: 8, in: 'any' }] }),
    )
    expect(score(job({ descriptionText: 'A reactive, proactive team' })).score).toBe(0)
    expect(score(job({ descriptionText: 'We use REACT daily' })).score).toBe(8)
  })

  it('subtracts negative signals and lists the largest effects first', () => {
    const score = createScorer(
      criteria({
        signals: [
          { label: 'TypeScript', phrases: ['typescript'], weight: 6, in: 'any' },
          { label: 'Backend', phrases: ['backend'], weight: -8, in: 'title' },
        ],
      }),
    )
    const s = score(job({ title: 'Backend Engineer', descriptionText: 'TypeScript services' }))
    expect(s.score).toBe(-2)
    expect(s.reasons.map((r) => r.label)).toEqual(['Backend', 'TypeScript'])
  })

  it('scores location eligibility, and 0 for ones not listed', () => {
    const score = createScorer(
      criteria({ eligibility: { remote_canada_ok: 10, canada_hybrid: 4 } }),
    )
    expect(score(job()).reasons).toEqual([{ label: 'Remote · Canada OK', points: 10 }])
    expect(score(job({ eligibility: 'canada_onsite' }))).toMatchObject({ score: 0, reasons: [] })
  })

  it('reports the first matching dealbreaker without changing the score', () => {
    const score = createScorer(
      criteria({
        signals: [{ label: 'React', phrases: ['react'], weight: 8, in: 'any' }],
        dealbreakers: [{ label: 'Clearance', phrases: ['security clearance'], in: 'any' }],
      }),
    )
    const s = score(job({ descriptionText: 'React. Requires Security Clearance.' }))
    expect(s.dealbreaker).toBe('Clearance')
    expect(s.score).toBe(8)
  })

  describe('salary floor', () => {
    const score = createScorer(
      criteria({ salary: { currency: 'cad', floor: 140_000, belowFloor: -15 } }),
    )
    const paid = (over: Partial<ScorableJob>) =>
      score(job({ salaryCurrency: 'CAD', salaryPeriod: 'year', ...over })).score

    it('penalizes an annual salary in the same currency whose top is below the floor', () => {
      expect(paid({ salaryMin: 100_000, salaryMax: 130_000 })).toBe(-15)
      expect(paid({ salaryMin: 120_000, salaryMax: null })).toBe(-15)
    })

    it('leaves salaries at or above the floor alone', () => {
      expect(paid({ salaryMin: 120_000, salaryMax: 150_000 })).toBe(0)
      expect(paid({ salaryMin: 140_000, salaryMax: 140_000 })).toBe(0)
    })

    it('ignores other currencies, non-annual periods and missing salaries', () => {
      expect(paid({ salaryMax: 100_000, salaryCurrency: 'USD' })).toBe(0)
      expect(paid({ salaryMax: 60, salaryPeriod: 'hour' })).toBe(0)
      expect(paid({})).toBe(0)
    })
  })
})

describe('compareScores', () => {
  it('puts dealbreakers last, then the highest score first', () => {
    const a = { score: 5, reasons: [], dealbreaker: null }
    const b = { score: 20, reasons: [], dealbreaker: 'Clearance' }
    const c = { score: 12, reasons: [], dealbreaker: null }
    expect([a, b, c].toSorted(compareScores)).toEqual([c, a, b])
  })
})

describe('parseCriteria', () => {
  it('fills in defaults for a minimal file', () => {
    expect(parseCriteria('criteria.json', '{}')).toEqual({
      signals: [],
      dealbreakers: [],
      eligibility: {},
    })
  })

  it('names the file and field for a typo', () => {
    const text = JSON.stringify({ signals: [{ label: 'React', phrases: ['react'], weigth: 8 }] })
    expect(() => parseCriteria('config/criteria.json', text)).toThrow(
      /Invalid config\/criteria\.json[\s\S]*signals\[0\]/,
    )
  })

  it('rejects an unknown eligibility and a positive salary penalty', () => {
    expect(() => parseCriteria('c.json', '{"eligibility":{"mars":5}}')).toThrow(/eligibility/)
    expect(() =>
      parseCriteria('c.json', '{"salary":{"currency":"CAD","floor":1,"belowFloor":5}}'),
    ).toThrow(/belowFloor/)
  })
})
