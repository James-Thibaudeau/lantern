import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ashby } from '../adapters/ashby'
import { greenhouse } from '../adapters/greenhouse'
import { lever } from '../adapters/lever'
import type { NormalizeResult } from '../adapters/types'
import { JobSchema, type Company, type Eligibility, type Job } from '../schema'

// Fixtures are real public API responses (Greenhouse: Tailscale, Lever: Fullscript,
// Ashby: Wealthsimple) with description fields truncated to about 400 characters.
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T
}

type Raw = Record<string, unknown>
const ghJobs = fixture<{ jobs: Raw[] }>('greenhouse.json').jobs
const leverJobs = fixture<Raw[]>('lever.json')
const ashbyJobs = fixture<{ jobs: Raw[] }>('ashby.json').jobs

const ghCompany: Company = { name: 'Tailscale', ats: 'greenhouse', slug: 'tailscale' }
const leverCompany: Company = { name: 'Fullscript', ats: 'lever', slug: 'fullscript' }
const ashbyCompany: Company = { name: 'Wealthsimple', ats: 'ashby', slug: 'wealthsimple' }

function expectOk(r: NormalizeResult): Job {
  if (!r.ok) throw new Error(`normalize failed: ${r.error}`)
  return r.job
}

const byId = (jobs: Raw[], id: string | number) => {
  const j = jobs.find((x) => x.id === id)
  if (!j) throw new Error(`fixture posting ${id} not found`)
  return j
}

describe('greenhouse.normalize', () => {
  it.each(ghJobs.map((j) => [j.id, j] as const))('posting %s normalizes ok and passes JobSchema', (_id, raw) => {
    const job = expectOk(greenhouse.normalize(raw, ghCompany))
    expect(JobSchema.parse(job)).toEqual(job)
    expect(job.source).toBe('greenhouse')
    expect(job.companySlug).toBe('tailscale')
    expect(job.company).toBe('Tailscale')
  })

  it('decodes the entity-escaped content into real HTML', () => {
    for (const raw of ghJobs) {
      expect(raw.content as string).toMatch(/^&lt;/)
      const job = expectOk(greenhouse.normalize(raw, ghCompany))
      expect(job.descriptionHtml.startsWith('<')).toBe(true)
      expect(job.descriptionHtml).not.toContain('&lt;')
      expect(job.descriptionText).not.toMatch(/[<>]/)
      expect(job.descriptionText).toContain('Tailscale')
    }
  })

  it('maps fields from a real posting', () => {
    const job = expectOk(greenhouse.normalize(byId(ghJobs, 4732874005), ghCompany))
    expect(job).toMatchObject({
      sourceJobId: '4732874005',
      title: 'Software Engineer, Networking (Dataplane)',
      url: 'https://job-boards.greenhouse.io/tailscale/jobs/4732874005',
      applyUrl: 'https://job-boards.greenhouse.io/tailscale/jobs/4732874005',
      locationText: 'Remote (Canada)',
      salary: null,
    })
    expect(job.updatedAt).toMatch(/Z$/)
  })

  it.each<[number, Eligibility]>([
    [4732874005, 'remote_canada_ok'], // Remote (Canada)
    [4732897005, 'remote_us_only'], // Remote (United States)
    [4740660005, 'canada_hybrid'], // Hybrid (Toronto, Ontario), single office
    [4726020005, 'remote_non_canada'], // Remote (Singapore)
  ])('posting %s → %s', (id, expected) => {
    expect(expectOk(greenhouse.normalize(byId(ghJobs, id), ghCompany)).eligibility).toBe(expected)
  })

  it('adds the office location only when there is exactly one office', () => {
    const single = expectOk(greenhouse.normalize(byId(ghJobs, 4740660005), ghCompany))
    expect(single.locationText).toBe('Hybrid (Toronto, Ontario); Toronto, Ontario, Canada')
    const many = expectOk(greenhouse.normalize(byId(ghJobs, 4732874005), ghCompany))
    expect(many.locationText).toBe('Remote (Canada)')
  })

  it('id is stable and depends on the company slug', () => {
    const raw = ghJobs[0]
    const a = expectOk(greenhouse.normalize(raw, ghCompany))
    const b = expectOk(greenhouse.normalize(structuredClone(raw), ghCompany))
    const other = expectOk(greenhouse.normalize(raw, { ...ghCompany, slug: 'tailscale-ca' }))
    expect(a.id).toBe(b.id)
    expect(a.id).toMatch(/^[0-9a-f]{24}$/)
    expect(a.contentHash).toBe(b.contentHash)
    expect(other.id).not.toBe(a.id)
  })

  it('contentHash changes when the title changes; id does not', () => {
    const raw = ghJobs[0]
    const a = expectOk(greenhouse.normalize(raw, ghCompany))
    const b = expectOk(greenhouse.normalize({ ...raw, title: `${raw.title as string} II` }, ghCompany))
    expect(b.id).toBe(a.id)
    expect(b.contentHash).not.toBe(a.contentHash)
  })

  it('returns ok:false instead of throwing when title is missing', () => {
    const { title: _omit, ...raw } = ghJobs[0]
    const r = greenhouse.normalize(raw, ghCompany)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(typeof r.error).toBe('string')
      expect(r.error).toMatch(/title/)
      expect(r.sourceJobId).toBe(String(ghJobs[0].id))
    }
  })

  it('returns ok:false for a non-URL absolute_url (caught by JobSchema)', () => {
    const r = greenhouse.normalize({ ...ghJobs[0], absolute_url: 'not a url' }, ghCompany)
    expect(r.ok).toBe(false)
  })

  it('returns ok:false for non-object input', () => {
    expect(greenhouse.normalize(null, ghCompany).ok).toBe(false)
    expect(greenhouse.normalize('nope', ghCompany).ok).toBe(false)
  })

  it('handles missing content', () => {
    const { content: _omit, ...raw } = ghJobs[0]
    const job = expectOk(greenhouse.normalize(raw, ghCompany))
    expect(job.descriptionHtml).toBe('')
    expect(job.descriptionText).toBe('')
  })
})

describe('lever.normalize', () => {
  it.each(leverJobs.map((j) => [j.id, j] as const))('posting %s normalizes ok and passes JobSchema', (_id, raw) => {
    const job = expectOk(lever.normalize(raw, leverCompany))
    expect(JobSchema.parse(job)).toEqual(job)
    expect(job.source).toBe('lever')
    expect(job.postedAt).toMatch(/Z$/)
  })

  it.each<[string, Eligibility]>([
    ['48afd4ef-dff0-4b59-94a2-3a3df2aa3c34', 'remote_canada_ok'], // Ottawa, ON; CA; remote
    ['0e42d27c-8f96-4ad8-98cd-fc7334a01a9e', 'remote_canada_ok'], // Canada Remote; USA Remote
    ['da672c0a-c946-4a6c-a4ed-97aa7ca9bca0', 'canada_hybrid'], // Ottawa, ON; CA; hybrid
    ['c3e724cf-97f8-4276-8c25-eb0c56d2b3ab', 'non_canada_onsite'], // Ashland, VA; US; onsite
  ])('posting %s → %s', (id, expected) => {
    expect(expectOk(lever.normalize(byId(leverJobs, id), leverCompany)).eligibility).toBe(expected)
  })

  it('includes every list (heading + items) in descriptionHtml, between description and additional', () => {
    const raw = byId(leverJobs, '48afd4ef-dff0-4b59-94a2-3a3df2aa3c34')
    const lists = raw.lists as { text: string; content: string }[]
    expect(lists.length).toBeGreaterThan(0)
    const job = expectOk(lever.normalize(raw, leverCompany))
    for (const l of lists) {
      expect(job.descriptionHtml).toContain(`<ul>${l.content}</ul>`)
      expect(job.descriptionText).toContain(l.text)
    }
    expect(job.descriptionHtml.startsWith(raw.description as string)).toBe(true)
    expect(job.descriptionHtml.endsWith(raw.additional as string)).toBe(true)
  })

  it('escapes list headings', () => {
    const raw = { ...leverJobs[0], lists: [{ text: 'R&D <team>', content: '<li>x</li>' }] }
    const job = expectOk(lever.normalize(raw, leverCompany))
    expect(job.descriptionHtml).toContain('<h3>R&amp;D &lt;team&gt;</h3>')
    expect(job.descriptionText).toContain('R&D <team>')
  })

  it('joins all locations into locationText', () => {
    const job = expectOk(lever.normalize(byId(leverJobs, '0e42d27c-8f96-4ad8-98cd-fc7334a01a9e'), leverCompany))
    expect(job.locationText).toBe('Canada Remote; USA Remote')
  })

  it('maps salaryRange when present', () => {
    const raw = {
      ...leverJobs[0],
      salaryRange: { min: 120000, max: 150000, currency: 'CAD', interval: 'per-year-salary' },
    }
    expect(expectOk(lever.normalize(raw, leverCompany)).salary).toEqual({
      min: 120000,
      max: 150000,
      currency: 'CAD',
      period: 'year',
    })
  })

  it('returns ok:false instead of throwing when text (title) is missing', () => {
    const { text: _omit, ...raw } = leverJobs[0]
    const r = lever.normalize(raw, leverCompany)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(typeof r.error).toBe('string')
      expect(r.sourceJobId).toBe(leverJobs[0].id)
    }
  })
})

describe('ashby.normalize', () => {
  it.each(ashbyJobs.map((j) => [j.title, j] as const))('"%s" normalizes ok and passes JobSchema', (_t, raw) => {
    const job = expectOk(ashby.normalize(raw, ashbyCompany))
    expect(JobSchema.parse(job)).toEqual(job)
    expect(job.source).toBe('ashby')
  })

  const byTitle = (title: string) => {
    const j = ashbyJobs.find((x) => x.title === title)
    if (!j) throw new Error(`fixture posting "${title}" not found`)
    return j
  }

  it.each<[string, Eligibility]>([
    ['Manager, Treasury Cash & Settlements', 'remote_canada_ok'], // Remote (Canada)
    ['Staff/Senior Product Designer, Growth', 'remote_us_only'], // Remote (US)
    ['Senior Executive Assistant', 'canada_hybrid'], // Toronto Headquarters, Hybrid
    ['Quantitative Trader', 'remote_canada_ok'], // Remote (Canada) + secondary Remote (US)
  ])('"%s" → %s', (title, expected) => {
    expect(expectOk(ashby.normalize(byTitle(title), ashbyCompany)).eligibility).toBe(expected)
  })

  it("maps the Salary component: '1 YEAR' → period 'year' with CAD", () => {
    const job = expectOk(ashby.normalize(byTitle('Manager, Treasury Cash & Settlements'), ashbyCompany))
    expect(job.salary).toEqual({ min: 116000, max: 145000, currency: 'CAD', period: 'year' })
  })

  it('salary is null when there is no compensation', () => {
    const job = expectOk(ashby.normalize(byTitle('Staff/Senior Product Designer, Growth'), ashbyCompany))
    expect(job.salary).toBeNull()
  })

  it('ignores non-salary components and maps hourly pay', () => {
    const raw = {
      ...ashbyJobs[0],
      compensation: {
        summaryComponents: [
          { compensationType: 'EquityCashValue', interval: '1 YEAR', currencyCode: 'CAD', minValue: null, maxValue: null },
          { compensationType: 'Salary', interval: '1 HOUR', currencyCode: 'CAD', minValue: 25, maxValue: 26.5 },
        ],
      },
    }
    expect(expectOk(ashby.normalize(raw, ashbyCompany)).salary).toEqual({
      min: 25,
      max: 26.5,
      currency: 'CAD',
      period: 'hour',
    })
  })

  it('joins primary and secondary locations', () => {
    const job = expectOk(ashby.normalize(byTitle('Quantitative Trader'), ashbyCompany))
    expect(job.locationText).toBe('Remote (Canada); Remote (US)')
  })

  it('returns ok:false instead of throwing when title is missing', () => {
    const { title: _omit, ...raw } = ashbyJobs[0]
    const r = ashby.normalize(raw, ashbyCompany)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(typeof r.error).toBe('string')
      expect(r.error).toMatch(/title/)
      expect(r.sourceJobId).toBe(ashbyJobs[0].id)
    }
  })
})

describe('fixtures', () => {
  it('keep descriptions short (public repo)', () => {
    const fields = [
      ...ghJobs.map((j) => j.content),
      ...ashbyJobs.flatMap((j) => [j.descriptionHtml, j.descriptionPlain]),
      ...leverJobs.flatMap((j) => [j.description, j.descriptionPlain, j.additional, j.additionalPlain]),
    ]
    for (const f of fields) if (typeof f === 'string') expect(f.length).toBeLessThanOrEqual(400)
  })
})
