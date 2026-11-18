import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Job } from '../schema'
import { applyState, readState, writeState, type SeenState } from '../state'

const job = (id: string, companySlug: string, contentHash = `h-${id}`): Job =>
  ({ id, companySlug, contentHash }) as Job

const state = (jobs: SeenState['jobs']): SeenState => ({
  version: 1,
  generatedAt: '2026-11-16T11:17:00.000Z',
  jobs,
})

const SLUGS = ['a', 'b', 'c']

describe('applyState', () => {
  it('sends everything when there is no previous state', () => {
    const kept = [job('1', 'a'), job('2', 'b')]
    const r = applyState({ kept, open: { completeCompanies: ['a', 'b'] } as never }, null, SLUGS)
    expect(r.emit.map((j) => j.id)).toEqual(['1', '2'])
    expect(r.changes).toEqual({ stateFound: false, new: 2, updated: 0, unchanged: 0 })
    expect(Object.keys(r.next.jobs)).toEqual(['1', '2'])
  })

  it('sends only new and changed jobs', () => {
    const previous = state({ '1': { h: 'h-1', c: 'a' }, '2': { h: 'old', c: 'a' } })
    const kept = [job('1', 'a'), job('2', 'a'), job('3', 'a')]
    const r = applyState({ kept, open: { completeCompanies: ['a'] } as never }, previous, SLUGS)
    expect(r.emit.map((j) => j.id)).toEqual(['2', '3'])
    expect(r.changes).toEqual({ stateFound: true, new: 1, updated: 1, unchanged: 1 })
    expect(r.next.jobs['2']).toEqual({ h: 'h-2', c: 'a' })
  })

  it('drops jobs that are gone from a completely fetched company', () => {
    const previous = state({ gone: { h: 'x', c: 'a' } })
    const r = applyState({ kept: [], open: { completeCompanies: ['a'] } as never }, previous, SLUGS)
    expect(r.next.jobs).toEqual({})
  })

  it('carries forward companies that failed or were not fetched', () => {
    const previous = state({ b1: { h: 'x', c: 'b' }, c1: { h: 'y', c: 'c' } })
    // Only "a" was fetched completely (b failed, c was left out by --company).
    const r = applyState(
      { kept: [job('1', 'a')], open: { completeCompanies: ['a'] } as never },
      previous,
      SLUGS,
    )
    expect(r.next.jobs).toEqual({
      b1: { h: 'x', c: 'b' },
      c1: { h: 'y', c: 'c' },
      '1': { h: 'h-1', c: 'a' },
    })
  })

  it('forgets companies removed from the config', () => {
    const previous = state({ z1: { h: 'x', c: 'zed' } })
    const r = applyState({ kept: [], open: { completeCompanies: [] } as never }, previous, SLUGS)
    expect(r.next.jobs).toEqual({})
  })
})

describe('readState / writeState', () => {
  it('round-trips, and treats missing or malformed files as no state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lantern-state-'))
    const path = join(dir, 'nested', 'seen.json')

    expect(await readState(path)).toEqual({ state: null })

    const s = state({ '1': { h: 'h', c: 'a' } })
    await writeState(path, s)
    expect(await readState(path)).toEqual({ state: s })

    await writeFile(path, '{"version":2}')
    expect((await readState(path)).state).toBeNull()
    await writeFile(path, 'not json')
    expect((await readState(path)).warning).toMatch(/not valid JSON/)
  })
})
