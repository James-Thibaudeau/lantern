import { beforeEach, describe, expect, it } from 'vitest'

import { openDb, type Db } from '../../db'
import type { SuggestionRow } from '../../db/schema'
import type { Board, Detection } from '../detect'
import {
  decide,
  decidedKeys,
  getSuggestion,
  listSuggestions,
  saveSuggestions,
  suggestionCompany,
  type SuggestionSource,
} from '../suggestions'

const T1 = new Date('2026-11-01T12:00:00Z')
const T2 = new Date('2026-11-02T12:00:00Z')
const T3 = new Date('2026-11-03T12:00:00Z')

const ashby: Board = { ats: 'ashby', slug: 'Acme', supported: true }
const lever: Board = { ats: 'lever', slug: 'beta', supported: true }
const workday: Board = {
  ats: 'workday',
  slug: 'gamma',
  workday: { tenant: 'gamma', host: 'gamma.wd1.myworkdayjobs.com', site: 'Ext' },
  supported: false,
  note: 'Workday adapter not built yet',
}

function item(
  board: Board,
  name: string,
  check?: { openJobs: number; matchingJobs: number },
): Detection & SuggestionSource {
  return {
    board,
    via: 'link',
    name,
    check: check && { ok: true, ...check },
    source: 'hn',
    sourceUrl: 'https://news.ycombinator.com/item?id=1',
    sourceText: `${name} | Engineer | Remote`,
  }
}

function row(db: Db, id: string): SuggestionRow {
  const r = getSuggestion(db, id)
  if (!r) throw new Error(`no suggestion ${id}`)
  return r
}

describe('suggestions', () => {
  let db: Db

  beforeEach(() => {
    db = openDb(':memory:')
  })

  it('saves new boards as pending, with their companies.json entry', () => {
    const res = saveSuggestions(
      db,
      [item(ashby, 'Acme', { openJobs: 4, matchingJobs: 2 }), item(workday, 'Gamma')],
      T1,
    )
    expect(res).toEqual({ added: 2, refreshed: 0 })

    expect(row(db, 'ashby:acme')).toMatchObject({
      ats: 'ashby',
      slug: 'Acme',
      name: 'Acme',
      supported: true,
      note: null,
      via: 'link',
      source: 'hn',
      sourceUrl: 'https://news.ycombinator.com/item?id=1',
      sourceText: 'Acme | Engineer | Remote',
      openJobs: 4,
      matchingJobs: 2,
      checkError: null,
      status: 'pending',
      checkedAt: T1.toISOString(),
      createdAt: T1.toISOString(),
      decidedAt: null,
    })
    expect(JSON.parse(row(db, 'ashby:acme').company ?? 'null')).toEqual({
      name: 'Acme',
      ats: 'ashby',
      slug: 'Acme',
    })

    expect(row(db, 'workday:gamma')).toMatchObject({
      company: null,
      supported: false,
      note: 'Workday adapter not built yet',
      openJobs: null,
      matchingJobs: null,
    })
  })

  it('refreshes the counts of pending suggestions', () => {
    saveSuggestions(db, [item(ashby, 'Acme', { openJobs: 4, matchingJobs: 2 })], T1)
    const res = saveSuggestions(db, [item(ashby, 'Acme', { openJobs: 7, matchingJobs: 3 })], T2)
    expect(res).toEqual({ added: 0, refreshed: 1 })
    expect(row(db, 'ashby:acme')).toMatchObject({
      openJobs: 7,
      matchingJobs: 3,
      status: 'pending',
      checkedAt: T2.toISOString(),
      createdAt: T1.toISOString(),
    })
  })

  it('stores a failed check', () => {
    saveSuggestions(
      db,
      [
        {
          ...item(ashby, 'Acme'),
          check: { ok: false, openJobs: 0, matchingJobs: 0, error: 'HTTP 500' },
        },
      ],
      T1,
    )
    expect(row(db, 'ashby:acme')).toMatchObject({ openJobs: 0, checkError: 'HTTP 500' })
  })

  it('never changes or re-opens accepted and rejected suggestions', () => {
    saveSuggestions(
      db,
      [
        item(ashby, 'Acme', { openJobs: 4, matchingJobs: 2 }),
        item(lever, 'Beta', { openJobs: 1, matchingJobs: 1 }),
      ],
      T1,
    )
    expect(decide(db, 'ashby:acme', 'accepted', T2)).toBe(true)
    expect(decide(db, 'lever:beta', 'rejected', T2)).toBe(true)
    const before = [row(db, 'ashby:acme'), row(db, 'lever:beta')]

    const res = saveSuggestions(
      db,
      [
        item(ashby, 'Acme Renamed', { openJobs: 9, matchingJobs: 9 }),
        item(lever, 'Beta', { openJobs: 9, matchingJobs: 9 }),
      ],
      T3,
    )
    expect(res).toEqual({ added: 0, refreshed: 0 })
    expect([row(db, 'ashby:acme'), row(db, 'lever:beta')]).toEqual(before)
    expect(before.map((r) => r.status)).toEqual(['accepted', 'rejected'])
  })

  it('lists decided boards as keys to skip', () => {
    saveSuggestions(db, [item(ashby, 'Acme'), item(lever, 'Beta'), item(workday, 'Gamma')], T1)
    expect(decidedKeys(db)).toEqual(new Set())
    decide(db, 'ashby:acme', 'accepted', T2)
    decide(db, 'workday:gamma', 'rejected', T2)
    expect(decidedKeys(db)).toEqual(new Set(['ashby:acme', 'workday:gamma']))
  })

  it('lists supported boards first, then by matching jobs', () => {
    const delta: Board = { ats: 'greenhouse', slug: 'delta', supported: true }
    saveSuggestions(
      db,
      [
        item(ashby, 'Acme', { openJobs: 10, matchingJobs: 1 }),
        // Unsupported boards go last even with more matching jobs.
        item(workday, 'Gamma', { openJobs: 50, matchingJobs: 20 }),
        item(lever, 'Beta', { openJobs: 3, matchingJobs: 3 }),
        item(delta, 'Delta'),
      ],
      T1,
    )
    expect(listSuggestions(db).map((r) => r.id)).toEqual([
      'lever:beta',
      'ashby:acme',
      'greenhouse:delta',
      'workday:gamma',
    ])

    decide(db, 'lever:beta', 'rejected', T2)
    expect(listSuggestions(db).map((r) => r.id)).toEqual([
      'ashby:acme',
      'greenhouse:delta',
      'workday:gamma',
    ])
    expect(listSuggestions(db, 'rejected').map((r) => r.id)).toEqual(['lever:beta'])
    expect(listSuggestions(db, 'all')).toHaveLength(4)
  })

  it('decides only pending suggestions', () => {
    saveSuggestions(db, [item(ashby, 'Acme')], T1)
    expect(decide(db, 'ashby:acme', 'rejected', T2)).toBe(true)
    expect(row(db, 'ashby:acme')).toMatchObject({
      status: 'rejected',
      decidedAt: T2.toISOString(),
    })
    expect(decide(db, 'ashby:acme', 'accepted', T3)).toBe(false)
    expect(row(db, 'ashby:acme')).toMatchObject({
      status: 'rejected',
      decidedAt: T2.toISOString(),
    })
    expect(decide(db, 'ashby:missing', 'accepted', T3)).toBe(false)
  })

  it('reads the stored companies.json entry', () => {
    saveSuggestions(db, [item(ashby, 'Acme'), item(workday, 'Gamma')], T1)
    expect(suggestionCompany(row(db, 'ashby:acme'))).toEqual({
      name: 'Acme',
      ats: 'ashby',
      slug: 'Acme',
    })
    expect(suggestionCompany(row(db, 'workday:gamma'))).toBeNull()
    expect(suggestionCompany({ ...row(db, 'ashby:acme'), company: '{not json' })).toBeNull()
    expect(
      suggestionCompany({ ...row(db, 'ashby:acme'), company: '{"name":"x","ats":"nope"}' }),
    ).toBeNull()
  })
})
