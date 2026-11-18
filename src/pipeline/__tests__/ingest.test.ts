import { describe, expect, it } from 'vitest'

import type { HttpClient } from '../http'
import { HttpError } from '../http'
import { runIngest } from '../ingest'
import type { Company, Profile } from '../schema'

const profile: Profile = {
  id: 'fe',
  enabled: true,
  titleInclude: ['frontend', 'software engineer'],
  titleExclude: ['manager'],
  allowedEligibility: ['canada_onsite', 'canada_hybrid', 'remote_canada_ok', 'unknown'],
}

const companies: Company[] = [
  { name: 'Good Co', ats: 'greenhouse', slug: 'goodco' },
  { name: 'Broken Co', ats: 'greenhouse', slug: 'brokenco' },
  { name: 'Day Co', ats: 'workday', slug: 'dayco' },
]

const ghJob = (id: number, title: string, location: string) => ({
  id,
  title,
  absolute_url: `https://job-boards.greenhouse.io/goodco/jobs/${id}`,
  location: { name: location },
  content: '&lt;p&gt;Hello&lt;/p&gt;',
  updated_at: '2026-11-01T10:00:00-05:00',
  first_published: '2026-11-01T10:00:00-05:00',
})

function fakeHttp(): HttpClient {
  return {
    async getJson(url) {
      if (url.includes('/boards/goodco/')) {
        return {
          jobs: [
            ghJob(1, 'Senior Frontend Engineer', 'Remote, Canada'),
            ghJob(2, 'Senior Frontend Engineer', 'Remote, United States'),
            ghJob(3, 'Engineering Manager', 'Toronto, ON'),
            ghJob(4, 'Account Executive', 'Toronto, ON'),
            { id: 5 }, // malformed posting
            ghJob(1, 'Senior Frontend Engineer', 'Remote, Canada'), // duplicate
          ],
        }
      }
      throw new HttpError(404, url)
    },
    async postJson() {
      throw new Error('not used')
    },
  }
}

describe('runIngest', () => {
  it('fetches, normalizes, filters and reports per company', async () => {
    const result = await runIngest({
      config: { companies, profiles: [profile] },
      http: fakeHttp(),
      politeDelayMs: 0,
      runId: 'test-run',
    })

    expect(result.kept.map((j) => j.sourceJobId)).toEqual(['1'])

    const [good, broken, day] = result.report.companies
    expect(good).toMatchObject({
      status: 'ok',
      complete: true,
      fetched: 6,
      normalized: 4,
      normalizeErrors: 1,
      kept: 1,
      droppedTitle: 2,
      droppedEligibility: 1,
    })
    expect(broken).toMatchObject({ status: 'error', complete: false })
    expect(broken.error).toContain('404')
    expect(day).toMatchObject({ status: 'skipped', complete: false })

    expect(result.report.failed).toBe(false)
    expect(result.open.completeCompanies).toEqual(['goodco'])
    expect(result.open.jobs).toHaveLength(1)
    expect(result.report.eligibility.remote_canada_ok).toBe(1)
    expect(result.report.eligibility.remote_us_only).toBe(1)
  })

  it('only fetches the requested companies', async () => {
    const result = await runIngest({
      config: { companies, profiles: [profile] },
      http: fakeHttp(),
      only: ['brokenco'],
      politeDelayMs: 0,
    })
    expect(result.report.companies.map((c) => c.slug)).toEqual(['brokenco'])
    // Nothing fetched successfully, so the run fails and nothing counts as complete.
    expect(result.report.failed).toBe(true)
    expect(result.open.completeCompanies).toEqual([])
  })

  it('rejects unknown company slugs', async () => {
    await expect(
      runIngest({
        config: { companies, profiles: [profile] },
        http: fakeHttp(),
        only: ['nope'],
        politeDelayMs: 0,
      }),
    ).rejects.toThrow('Unknown company slug(s): nope')
  })
})
