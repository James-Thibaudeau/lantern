import { describe, expect, it } from 'vitest'

import { CriteriaSchema } from '../criteria'
import { rankingPreview, type PreviewJob } from '../preview'
import { createScorer } from '../score'

const job = (id: string, title: string, description = ''): PreviewJob => ({
  id,
  title,
  company: 'Acme',
  firstSeenAt: `2026-11-${id.padStart(2, '0')}T00:00:00.000Z`,
  descriptionText: description,
  locationText: 'Remote',
  eligibility: 'remote_canada_ok',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
})

const jobs = [
  job('1', 'Backend Engineer'),
  job('2', 'Frontend Engineer'),
  job('3', 'Platform Engineer', 'Requires security clearance'),
]

const scorer = (c: unknown) => createScorer(CriteriaSchema.parse(c))

describe('rankingPreview', () => {
  it('ranks without saved criteria', () => {
    const p = rankingPreview(jobs, scorer({}), null)
    // All score 0: newest first.
    expect(p.top.map((r) => r.id)).toEqual(['3', '2', '1'])
    expect(p).toMatchObject({ moved: 0, dealbreakersBefore: null, total: 3 })
    expect(p.top[0].before).toBeNull()
  })

  it('shows how new criteria move jobs and add dealbreakers', () => {
    const saved = scorer({})
    const next = scorer({
      signals: [{ label: 'Frontend', phrases: ['frontend'], weight: 10, in: 'title' }],
      dealbreakers: [{ label: 'Clearance', phrases: ['security clearance'] }],
    })
    const p = rankingPreview(jobs, next, saved)
    expect(p.top.map((r) => [r.id, r.score, r.rank, r.rankBefore])).toEqual([
      ['2', 10, 1, 2],
      ['1', 0, 2, 3],
      ['3', 0, 3, 1],
    ])
    expect(p.top[2].dealbreaker).toBe('Clearance')
    expect(p).toMatchObject({ dealbreakers: 1, dealbreakersBefore: 0, moved: 3 })
  })

  it('limits the list', () => {
    expect(rankingPreview(jobs, scorer({}), null, 2).top).toHaveLength(2)
  })
})
