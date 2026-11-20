import { describe, expect, it } from 'vitest'

import { lever } from '../adapters/lever'
import { recruitee, recruiteeDate } from '../adapters/recruitee'
import type { FetchContext } from '../adapters/types'
import { workable } from '../adapters/workable'
import type { HttpClient } from '../http'
import type { Company } from '../schema'

// Synthetic postings in the shape of each API (checked against live boards).

function ctx(respond: (url: string) => unknown): { ctx: FetchContext; urls: string[] } {
  const urls: string[] = []
  const http: HttpClient = {
    getJson: async (url) => {
      urls.push(url)
      return respond(url)
    },
    postJson: async () => {
      throw new Error('unexpected POST')
    },
  }
  return { ctx: { http, searchTerms: [], maxDetailCalls: 50 }, urls }
}

const offer = (over: Record<string, unknown> = {}) => ({
  id: 2835423,
  title: 'Senior Frontend Engineer',
  status: 'published',
  careers_url: 'https://acme.recruitee.com/o/senior-frontend-engineer',
  careers_apply_url: 'https://acme.recruitee.com/o/senior-frontend-engineer/c/new',
  location: 'Toronto, Ontario, Canada',
  country_code: 'CA',
  remote: false,
  hybrid: true,
  on_site: false,
  locations: [{ name: 'Canada, Toronto', country_code: 'CA' }],
  description: '<p>Build the <b>UI</b>.</p>',
  requirements: '<ul><li>React</li></ul>',
  salary: { min: '140000', max: '170000', currency: 'CAD', period: 'year' },
  published_at: '2026-11-20 11:15:31 UTC',
  updated_at: '2026-11-21 09:00:00 UTC',
  ...over,
})

const acmeRecruitee: Company = { name: 'Acme', ats: 'recruitee', slug: 'acme' }

describe('recruitee', () => {
  it('fetches every offer from the careers API', async () => {
    const { ctx: c, urls } = ctx(() => ({ offers: [offer(), offer({ id: 2 })] }))
    const res = await recruitee.fetch(acmeRecruitee, c)
    expect(urls).toEqual(['https://acme.recruitee.com/api/offers/'])
    expect(res).toEqual({ raw: [offer(), offer({ id: 2 })], complete: true })
  })

  it('maps an offer, with salary and the hybrid flag', () => {
    const r = recruitee.normalize(offer(), acmeRecruitee)
    if (!r.ok) throw new Error(r.error)
    expect(r.job).toMatchObject({
      source: 'recruitee',
      sourceJobId: '2835423',
      title: 'Senior Frontend Engineer',
      url: 'https://acme.recruitee.com/o/senior-frontend-engineer',
      applyUrl: 'https://acme.recruitee.com/o/senior-frontend-engineer/c/new',
      locationText: 'Canada, Toronto',
      workplaceType: 'hybrid',
      eligibility: 'canada_hybrid',
      salary: { min: 140000, max: 170000, currency: 'CAD', period: 'year' },
      postedAt: '2026-11-20T11:15:31.000Z',
    })
    expect(r.job.descriptionText).toContain('Build the UI.')
    expect(r.job.descriptionText).toContain('React')
  })

  it('reads remote offers and falls back to the location text', () => {
    const r = recruitee.normalize(
      offer({
        remote: true,
        hybrid: false,
        locations: [],
        location: 'Remote, Canada',
        salary: null,
      }),
      acmeRecruitee,
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.job).toMatchObject({
      locationText: 'Remote, Canada',
      eligibility: 'remote_canada_ok',
      salary: null,
    })
  })

  it('skips offers that are not published', () => {
    expect(recruitee.normalize(offer({ status: 'closed' }), acmeRecruitee).ok).toBe(false)
  })

  it('parses Recruitee dates', () => {
    expect(recruiteeDate('2026-11-20 11:15:31 UTC')).toBe('2026-11-20T11:15:31.000Z')
    expect(recruiteeDate(null)).toBeNull()
  })
})

const job = (over: Record<string, unknown> = {}) => ({
  title: 'Frontend Developer',
  shortcode: '2FAA7C0BC6',
  url: 'https://apply.workable.com/j/2FAA7C0BC6',
  application_url: 'https://apply.workable.com/j/2FAA7C0BC6/apply',
  telecommuting: false,
  published_on: '2026-10-02',
  created_at: '2026-09-25',
  country: 'Canada',
  city: 'Ottawa',
  state: 'Ontario',
  locations: [
    { country: 'Canada', countryCode: 'CA', city: 'Ottawa', region: 'Ontario', hidden: false },
  ],
  description: '<p>Hello</p>',
  ...over,
})

const acmeWorkable: Company = { name: 'Acme', ats: 'workable', slug: 'acme' }

describe('workable', () => {
  it('fetches jobs with details from the widget API', async () => {
    const { ctx: c, urls } = ctx(() => ({ name: 'Acme Inc', jobs: [job()] }))
    const res = await workable.fetch(acmeWorkable, c)
    expect(urls).toEqual(['https://apply.workable.com/api/v1/widget/accounts/acme?details=true'])
    expect(res.raw).toEqual([job()])
  })

  it('maps a job', () => {
    const r = workable.normalize(job(), acmeWorkable)
    if (!r.ok) throw new Error(r.error)
    expect(r.job).toMatchObject({
      source: 'workable',
      sourceJobId: '2FAA7C0BC6',
      url: 'https://apply.workable.com/j/2FAA7C0BC6',
      applyUrl: 'https://apply.workable.com/j/2FAA7C0BC6/apply',
      locationText: 'Ottawa, Ontario, Canada',
      country: 'CA',
      eligibility: 'canada_onsite',
      postedAt: '2026-10-02T00:00:00.000Z',
    })
  })

  it('treats telecommuting as remote and drops hidden locations', () => {
    const r = workable.normalize(
      job({
        telecommuting: true,
        locations: [
          { country: 'Canada', countryCode: 'CA', city: '', region: '', hidden: false },
          { country: 'Estonia', countryCode: 'EE', city: 'Tallinn', region: '', hidden: true },
        ],
      }),
      acmeWorkable,
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.job).toMatchObject({ locationText: 'Canada', eligibility: 'remote_canada_ok' })
  })
})

describe('workable repeats', () => {
  it('merges a job listed once per location into one job with every location', async () => {
    const tallinn = job({
      locations: [
        { country: 'Estonia', countryCode: 'EE', city: 'Tallinn', region: '', hidden: false },
      ],
    })
    const remoteCanada = job({
      telecommuting: true,
      locations: [{ country: 'Canada', countryCode: 'CA', city: '', region: '', hidden: false }],
    })
    const other = job({ shortcode: 'OTHER', title: 'Designer' })
    const { ctx: c } = ctx(() => ({ jobs: [tallinn, remoteCanada, tallinn, other] }))
    const res = await workable.fetch(acmeWorkable, c)
    expect(res.raw).toHaveLength(2)

    const r = workable.normalize(res.raw[0], acmeWorkable)
    if (!r.ok) throw new Error(r.error)
    expect(r.job.locationText).toBe('Tallinn, Estonia; Canada')
  })
})

describe('lever region', () => {
  it('reads EU-hosted boards from the EU API', async () => {
    const { ctx: c, urls } = ctx(() => [])
    await lever.fetch({ name: 'Acme', ats: 'lever', slug: 'acme', region: 'eu' }, c)
    await lever.fetch({ name: 'Acme', ats: 'lever', slug: 'acme' }, c)
    expect(urls).toEqual([
      'https://api.eu.lever.co/v0/postings/acme?mode=json',
      'https://api.lever.co/v0/postings/acme?mode=json',
    ])
  })
})
