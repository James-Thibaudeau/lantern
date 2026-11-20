import { describe, expect, it, vi } from 'vitest'

import { HttpError } from '../../pipeline/http'
import {
  boardUrl,
  checkBoard,
  completeDetections,
  detectFromSite,
  extractUrls,
  findBoards,
  guessSlugs,
  looksLikeSameCompany,
  parseBoardUrl,
  toCompany,
  type Board,
} from '../detect'
import { ashbyFixture, fakeHttp, profile } from './fakes'

const ASHBY_API = 'https://api.ashbyhq.com/posting-api/job-board'
const GH_API = 'https://boards-api.greenhouse.io/v1/boards'
const LEVER_API = 'https://api.lever.co/v0/postings'

const emptyPage = async (_url: string) => ''
const pageWithoutLinks = async (_url: string) => '<html><body>Hello</body></html>'

const boardRoutes = (): [string, unknown][] => [
  [`${ASHBY_API}/wealthsimple`, ashbyFixture()],
  [
    `${ASHBY_API}/broken`,
    (url: string) => {
      throw new HttpError(500, url)
    },
  ],
  [`${GH_API}/gitlab`, { name: 'GitLab' }],
  [`${GH_API}/gitlab/jobs`, { jobs: [] }],
]

describe('parseBoardUrl', () => {
  it.each([
    ['https://boards.greenhouse.io/tailscale', 'tailscale'],
    ['https://job-boards.greenhouse.io/tailscale/jobs/123', 'tailscale'],
    ['https://job-boards.eu.greenhouse.io/acme', 'acme'],
    ['https://boards.greenhouse.io/embed/job_board?for=acme', 'acme'],
    ['https://boards-api.greenhouse.io/v1/boards/acme/jobs', 'acme'],
  ])('reads Greenhouse URL %s', (url, slug) => {
    expect(parseBoardUrl(url)).toEqual({ ats: 'greenhouse', slug, supported: true })
  })

  it('ignores Greenhouse URLs without a board', () => {
    expect(parseBoardUrl('https://boards.greenhouse.io/embed/job_board')).toBeNull()
    expect(parseBoardUrl('https://boards.greenhouse.io/')).toBeNull()
  })

  it('reads Lever boards, including EU-hosted ones', () => {
    expect(parseBoardUrl('https://jobs.lever.co/fullscript/abc-123')).toEqual({
      ats: 'lever',
      slug: 'fullscript',
      supported: true,
    })
    expect(parseBoardUrl('https://jobs.eu.lever.co/acme')).toEqual({
      ats: 'lever',
      slug: 'acme',
      region: 'eu',
      supported: true,
    })
    expect(
      toCompany({ ats: 'lever', slug: 'acme', region: 'eu', supported: true }, 'Acme'),
    ).toEqual({ name: 'Acme', ats: 'lever', slug: 'acme', region: 'eu' })
    expect(boardUrl({ ats: 'lever', slug: 'acme', region: 'eu' })).toBe(
      'https://jobs.eu.lever.co/acme',
    )
  })

  it('reads Ashby boards and decodes the slug', () => {
    expect(parseBoardUrl('https://jobs.ashbyhq.com/wealthsimple/a3468f20')).toEqual({
      ats: 'ashby',
      slug: 'wealthsimple',
      supported: true,
    })
    expect(parseBoardUrl('https://jobs.ashbyhq.com/Acme%20Corp')).toEqual({
      ats: 'ashby',
      slug: 'Acme Corp',
      supported: true,
    })
  })

  it('reads Workday boards with or without a locale', () => {
    const expected = {
      ats: 'workday',
      slug: 'acme',
      workday: { tenant: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: 'External' },
      supported: false,
      note: 'Workday adapter not built yet',
    }
    expect(parseBoardUrl('https://acme.wd5.myworkdayjobs.com/en-US/External/job/x')).toEqual(
      expected,
    )
    expect(parseBoardUrl('https://acme.wd5.myworkdayjobs.com/External')).toEqual(expected)
    expect(parseBoardUrl('https://acme.wd5.myworkdayjobs.com/')).toBeNull()
  })

  it('recognizes boards we cannot read yet', () => {
    expect(parseBoardUrl('https://acme.bamboohr.com/careers')).toMatchObject({
      ats: 'bamboohr',
      slug: 'acme',
      supported: false,
    })
    expect(parseBoardUrl('https://jobs.smartrecruiters.com/Acme1')).toMatchObject({
      ats: 'smartrecruiters',
      slug: 'Acme1',
      supported: false,
    })
  })

  it('reads Workable and Recruitee boards', () => {
    expect(parseBoardUrl('https://apply.workable.com/acme/')).toEqual({
      ats: 'workable',
      slug: 'acme',
      supported: true,
    })
    // Short job links and the API path aren't account slugs.
    expect(parseBoardUrl('https://apply.workable.com/j/2FAA7C0BC6')).toBeNull()
    expect(parseBoardUrl('https://acme.recruitee.com/o/engineer')).toEqual({
      ats: 'recruitee',
      slug: 'acme',
      supported: true,
    })
    expect(toCompany({ ats: 'recruitee', slug: 'acme', supported: true }, 'Acme')).toEqual({
      name: 'Acme',
      ats: 'recruitee',
      slug: 'acme',
    })
  })

  it.each([
    'https://example.com/careers',
    'https://www.bamboohr.com/pricing',
    'https://jobs.ashbyhq.com/',
    'https://jobs.lever.co',
    'not a url',
    '',
    'jobs.ashbyhq.com/acme',
  ])('returns null for %j', (url) => {
    expect(parseBoardUrl(url)).toBeNull()
  })
})

// An HN comment as Algolia returns it: slashes as &#x2F;, links both in <a href> and as text.
const HN_HTML =
  'Acme | Engineer | Remote<p>Apply at <a href="https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;acme" ' +
  'rel="nofollow">https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;acme</a>.<p>Or see ' +
  'https:&#x2F;&#x2F;boards.greenhouse.io&#x2F;acmeco, and https://acme.com!'

describe('malformed percent-escapes', () => {
  // Regression: a stray "%" in any URL used to throw URIError, and since findBoards runs over
  // whole HN posts, one such link made mineHiringThread fail for the entire thread.
  it('parseBoardUrl returns null for a non-board URL with a bare %', () => {
    expect(parseBoardUrl('https://example.com/100%')).toBeNull()
  })

  it('findBoards skips URLs it cannot decode', () => {
    expect(findBoards('Save 50% at https://example.com/50%off')).toEqual([])
  })
})

describe('extractUrls / findBoards', () => {
  it('decodes entities, strips trailing punctuation and collapses duplicates', () => {
    expect(extractUrls(HN_HTML)).toEqual([
      'https://jobs.ashbyhq.com/acme',
      'https://boards.greenhouse.io/acmeco',
      'https://acme.com',
    ])
  })

  it('finds one board per ATS and slug', () => {
    const html = `${HN_HTML} https://jobs.ashbyhq.com/acme/123 https://jobs.ashbyhq.com/ACME`
    expect(findBoards(html)).toEqual([
      { ats: 'ashby', slug: 'acme', supported: true },
      { ats: 'greenhouse', slug: 'acmeco', supported: true },
    ])
  })
})

describe('guessSlugs', () => {
  it('guesses from the domain, then the name, without duplicates', () => {
    expect(guessSlugs('Acme Rockets', 'https://www.acme.com/about')).toEqual([
      'acme',
      'acmerockets',
      'acme-rockets',
    ])
    expect(guessSlugs('Acme', 'https://acme.com')).toEqual(['acme'])
  })

  it('drops YC batches and company suffixes from names', () => {
    expect(guessSlugs('Dropbox (YC S07)', undefined)).toEqual(['dropbox'])
    expect(guessSlugs('Hooli Inc.', undefined)).toEqual(['hooli'])
  })

  it('returns at most 3 guesses', () => {
    expect(guessSlugs('Big Name Co', 'https://othername.io')).toHaveLength(3)
  })

  it('does not guess from shared hosting domains', () => {
    expect(guessSlugs('Acme', 'https://acme.vercel.app')).toEqual(['acme'])
    expect(guessSlugs(undefined, 'https://x.github.io/site')).toEqual([])
  })

  // Regression: two-part TLDs used to guess the suffix ("co" for acme.co.uk).
  it('guesses the company label for two-part TLDs', () => {
    expect(guessSlugs('Acme', 'https://acme.co.uk')).toEqual(['acme'])
  })

  it('ignores a site that is not a URL', () => {
    expect(guessSlugs('Acme', 'nope')).toEqual(['acme'])
  })
})

describe('looksLikeSameCompany', () => {
  it.each([
    ['GitLab', 'gitlab', true],
    ['Acme, Inc.', 'acme', true],
    ['Democorp', 'example', false],
    ['', 'example', false],
  ])('%j vs %j → %s', (name, slug, same) => {
    expect(looksLikeSameCompany(name, slug)).toBe(same)
  })
})

describe('detectFromSite', () => {
  it('returns boards linked from the page', async () => {
    const http = fakeHttp([])
    const fetchText = vi.fn<(url: string) => Promise<string>>(
      async () => '<a href="https://jobs.lever.co/acme">Careers</a> https://acme.com',
    )
    await expect(detectFromSite({ http, fetchText }, 'https://acme.com', 'Acme')).resolves.toEqual({
      boards: [{ ats: 'lever', slug: 'acme', supported: true }],
      via: 'page',
    })
    expect(fetchText).toHaveBeenCalledWith('https://acme.com')
    expect(http.calls).toEqual([])
  })

  it('guesses ashby, greenhouse, then lever when the page is unreachable', async () => {
    const http = fakeHttp([[`${LEVER_API}/acme`, []]])
    const fetchText = vi.fn<(url: string) => Promise<string>>(async () => {
      throw new HttpError(403, 'https://acme.com')
    })
    await expect(detectFromSite({ http, fetchText }, 'https://acme.com', 'Acme')).resolves.toEqual({
      boards: [{ ats: 'lever', slug: 'acme', supported: true }],
      via: 'guess',
    })
    expect(http.calls).toEqual([
      `${ASHBY_API}/acme`,
      `${GH_API}/acme/jobs`,
      `${LEVER_API}/acme?mode=json&limit=1`,
    ])
  })

  it('guesses when the page has no board links, and stops at the first hit', async () => {
    const http = fakeHttp([
      [`${ASHBY_API}/acme-rockets`, { jobs: [] }],
      [`${LEVER_API}/acme-rockets`, []],
    ])
    const fetchText = pageWithoutLinks
    const res = await detectFromSite({ http, fetchText }, 'https://acmerockets.io', 'Acme Rockets')
    expect(res).toEqual({
      boards: [{ ats: 'ashby', slug: 'acme-rockets', supported: true }],
      via: 'guess',
    })
    // acmerockets (from the domain and the name) misses on all three; then acme-rockets hits.
    expect(http.calls.filter((u) => u.includes('acme-rockets'))).toEqual([
      `${ASHBY_API}/acme-rockets`,
    ])
  })

  it('skips a guessed Greenhouse board whose company name does not match', async () => {
    const http = fakeHttp([
      [`${GH_API}/example/jobs`, { jobs: [] }],
      [`${GH_API}/example`, { name: 'Democorp' }],
    ])
    const fetchText = emptyPage
    await expect(
      detectFromSite({ http, fetchText }, 'https://example.com', 'Example'),
    ).resolves.toBeNull()
    expect(http.calls).toContain(`${GH_API}/example`)
    expect(http.calls).toContain(`${LEVER_API}/example?mode=json&limit=1`)
  })

  it('keeps a guessed Greenhouse board whose company name matches', async () => {
    const http = fakeHttp([
      [`${GH_API}/gitlab/jobs`, { jobs: [] }],
      [`${GH_API}/gitlab`, { name: 'GitLab' }],
    ])
    const fetchText = emptyPage
    await expect(
      detectFromSite({ http, fetchText }, 'https://gitlab.com', 'GitLab'),
    ).resolves.toEqual({
      boards: [{ ats: 'greenhouse', slug: 'gitlab', supported: true }],
      via: 'guess',
    })
  })

  it('passes on errors other than 404', async () => {
    const http = fakeHttp([
      [
        `${ASHBY_API}/acme`,
        (url: string) => {
          throw new HttpError(500, url)
        },
      ],
    ])
    await expect(
      detectFromSite({ http, fetchText: emptyPage }, 'https://acme.com', 'Acme'),
    ).rejects.toMatchObject({ name: 'HttpError', status: 500 })
  })
})

describe('checkBoard / completeDetections', () => {
  it('counts open jobs and jobs that pass the profiles', async () => {
    const http = fakeHttp(boardRoutes())
    await expect(
      checkBoard(http, { name: 'Wealthsimple', ats: 'ashby', slug: 'wealthsimple' }, [profile]),
    ).resolves.toEqual({ ok: true, openJobs: 4, matchingJobs: 2 })
  })

  it('reports a board that fails', async () => {
    const http = fakeHttp(boardRoutes())
    const check = await checkBoard(http, { name: 'Broken', ats: 'ashby', slug: 'broken' }, [
      profile,
    ])
    expect(check).toMatchObject({ ok: false, openJobs: 0, matchingJobs: 0 })
    expect(check.error).toContain('500')
  })

  it('names and checks each detection', async () => {
    const http = fakeHttp(boardRoutes())
    const workday: Board = {
      ats: 'workday',
      slug: 'acme-corp',
      workday: { tenant: 'acme-corp', host: 'acme-corp.wd1.myworkdayjobs.com', site: 'Ext' },
      supported: false,
    }
    const res = await completeDetections(
      http,
      [
        { board: { ats: 'ashby', slug: 'wealthsimple', supported: true }, via: 'link', name: 'WS' },
        { board: workday, via: 'link' },
        { board: { ats: 'ashby', slug: 'broken', supported: true }, via: 'page' },
        { board: { ats: 'greenhouse', slug: 'gitlab', supported: true }, via: 'guess', name: 'x' },
      ],
      [profile],
    )
    expect(res.map((d) => [d.name, d.via])).toEqual([
      ['WS', 'link'],
      ['Acme Corp', 'link'],
      ['Broken', 'page'],
      ['GitLab', 'guess'],
    ])
    expect(res[0].check).toEqual({ ok: true, openJobs: 4, matchingJobs: 2 })
    expect(res[1].check).toBeUndefined()
    expect(res[2].check).toMatchObject({ ok: false, error: expect.stringContaining('500') })
    expect(res[3].check).toEqual({ ok: true, openJobs: 0, matchingJobs: 0 })
  })
})

describe('boardUrl', () => {
  it.each([
    [{ ats: 'greenhouse', slug: 'acme' }, 'https://job-boards.greenhouse.io/acme'],
    [{ ats: 'ashby', slug: 'Acme Corp' }, 'https://jobs.ashbyhq.com/Acme%20Corp'],
    [
      {
        ats: 'workday',
        slug: 'acme',
        workday: { tenant: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: 'External' },
      },
      'https://acme.wd5.myworkdayjobs.com/External',
    ],
    [{ ats: 'workday', slug: 'acme' }, null],
    [{ ats: 'unknown', slug: 'acme' }, null],
  ])('%j → %s', (board, url) => {
    expect(boardUrl(board)).toBe(url)
  })
})
