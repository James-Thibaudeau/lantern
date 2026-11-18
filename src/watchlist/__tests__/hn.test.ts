import { describe, expect, it, vi } from 'vitest'

import { companyFromHeader, companySite, isRelevant, mineHiringThread, postHeader } from '../hn'
import { ashbyFixture, fakeHttp, profile } from './fakes'

const ALGOLIA = 'https://hn.algolia.com/api/v1'
const ASHBY_API = 'https://api.ashbyhq.com/posting-api/job-board'

describe('postHeader', () => {
  it('returns the first paragraph as plain text', () => {
    const html =
      'Acme (YC W21) | <a href="https:&#x2F;&#x2F;acme.com">Senior Engineer</a> | ' +
      'Toronto &amp; Remote<p>We&#x27;re hiring.<p>More text.'
    expect(postHeader(html)).toBe('Acme (YC W21) | Senior Engineer | Toronto & Remote')
  })

  it('caps the header at 300 characters', () => {
    expect(postHeader('x'.repeat(500))).toHaveLength(300)
  })
})

describe('companyFromHeader', () => {
  it.each([
    ['Acme (YC W21) | Senior Engineer | Remote', 'Acme'],
    ['Acme Rockets - rockets for everyone | Engineer', 'Acme Rockets'],
    ['Solo', 'Solo'],
  ])('%j → %j', (header, name) => {
    expect(companyFromHeader(header)).toBe(name)
  })

  it('gives up on a header that is too long to be a name', () => {
    expect(companyFromHeader(`${'word '.repeat(20)}| Engineer`)).toBeUndefined()
    expect(companyFromHeader('')).toBeUndefined()
  })
})

describe('isRelevant', () => {
  it.each([
    ['Acme | Engineer | Toronto', ''],
    ['Acme | Engineer | REMOTE', ''],
    ['Acme | Engineer | Onsite', 'Acme | Engineer | Onsite<p>We also hire in Vancouver, BC.'],
  ])('%j is relevant', (header, html) => {
    expect(isRelevant({ header, html: html || header })).toBe(true)
  })

  it('skips onsite posts outside Canada', () => {
    const header = 'Acme | Engineer | ONSITE | San Francisco'
    expect(isRelevant({ header, html: `${header}<p>Great office in SoMa.` })).toBe(false)
  })
})

describe('companySite', () => {
  it('skips job boards and social sites and returns the first company site', () => {
    const html =
      'Acme<p>https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;acme ' +
      'https://github.com/acme https://www.linkedin.com/company/acme ' +
      'https://news.ycombinator.com/item?id=1 https://x.com/acme https://forms.gle/abc ' +
      '<a href="https://www.acme.io/about">site</a> https://second.example.com'
    expect(companySite(html)).toBe('https://www.acme.io/about')
  })

  it('returns undefined when there is no company site', () => {
    expect(companySite('https://jobs.lever.co/acme https://github.com/acme')).toBeUndefined()
    expect(companySite('no links')).toBeUndefined()
  })
})

describe('mineHiringThread', () => {
  const posts = [
    {
      id: 101,
      text:
        'Acme (YC W21) | Senior Engineer | Remote (Canada)<p>Apply: ' +
        '<a href="https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;acme" rel="nofollow">' +
        'https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;acme</a>',
    },
    {
      id: 102,
      text: 'Beta | Backend Engineer | Toronto<p>https:&#x2F;&#x2F;boards.greenhouse.io&#x2F;beta',
    },
    {
      id: 103,
      text: 'Gamma | Engineer | ONSITE | San Francisco<p>https://jobs.lever.co/gamma',
    },
    {
      id: 104,
      text: 'Delta | Full Stack | REMOTE<p>We build things. See https://delta.io',
    },
    { id: 105, text: null },
    {
      id: 106,
      text: 'Acme | Designer | Vancouver, BC<p>https://jobs.ashbyhq.com/acme/123-456',
    },
  ]

  function deps() {
    const http = fakeHttp([
      [
        `${ALGOLIA}/search_by_date`,
        {
          hits: [
            { objectID: '900', title: 'Ask HN: Who wants to be hired?', created_at: '2026-11-01' },
            {
              objectID: '901',
              title: 'Ask HN: Who is hiring? (November 2026)',
              created_at: '2026-11-01',
            },
          ],
        },
      ],
      [
        `${ALGOLIA}/items/901`,
        {
          id: 901,
          title: 'Ask HN: Who is hiring? (November 2026)',
          created_at: '2026-11-01T15:00:00Z',
          children: posts.map((p) => ({
            id: p.id,
            author: 'someone',
            text: p.text,
            created_at: '2026-11-01T16:00:00Z',
          })),
        },
      ],
      [`${ASHBY_API}/acme`, ashbyFixture()],
      // Delta's guessed board exists but has no jobs.
      [`${ASHBY_API}/delta`, { jobs: [] }],
    ])
    const fetchText = vi.fn<(url: string) => Promise<string>>(
      async () => '<html><body>Delta: we build things.</body></html>',
    )
    return { http, fetchText }
  }

  it('finds new boards in relevant posts and checks them', async () => {
    const d = deps()
    const log = vi.fn<(line: string) => void>()
    const res = await mineHiringThread(d, {
      profiles: [profile],
      skip: new Set(['greenhouse:beta']),
      log,
    })

    expect(res.thread).toEqual({
      id: '901',
      title: 'Ask HN: Who is hiring? (November 2026)',
      createdAt: '2026-11-01T15:00:00Z',
    })
    expect(res.posts).toBe(5)
    expect(res.relevant).toBe(4)

    // Beta is skipped, Gamma is irrelevant, the second Acme link is a duplicate and Delta's
    // guessed board has no jobs.
    expect(res.suggestions).toHaveLength(1)
    const [acme] = res.suggestions
    expect(acme).toMatchObject({
      board: { ats: 'ashby', slug: 'acme', supported: true },
      via: 'link',
      name: 'Acme',
      check: { ok: true, openJobs: 4, matchingJobs: 2 },
      post: {
        id: '101',
        url: 'https://news.ycombinator.com/item?id=101',
        header: 'Acme (YC W21) | Senior Engineer | Remote (Canada)',
      },
    })

    expect(d.fetchText).toHaveBeenCalledTimes(1)
    expect(d.fetchText).toHaveBeenCalledWith('https://delta.io')
    expect(d.http.calls).toContain(`${ASHBY_API}/delta`)
    expect(d.http.calls.some((u) => u.includes('beta') || u.includes('gamma'))).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('5 posts, 4 mention'))
  })

  it('reads a given thread without searching', async () => {
    const d = deps()
    const res = await mineHiringThread(d, { threadId: '901', profiles: [profile], skip: new Set() })
    expect(d.http.calls.some((u) => u.includes('search_by_date'))).toBe(false)
    expect(res.suggestions.map((s) => s.board.slug)).toEqual(['acme', 'beta'])
  })
})
