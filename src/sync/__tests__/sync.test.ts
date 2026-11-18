import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { openDb, type Db } from '#/db'
import { companies, ingestRuns, jobs } from '#/db/schema'
import type { Job } from '#/pipeline/schema'

import type { RunArtifact, RunSource, RunnerRun } from '../github'
import { applyRun, parseRunFiles, sync, syncFromDir, type RunData } from '../sync'

// ---------- Helpers ----------

const T1 = '2026-11-10T10:00:00.000Z'
const T2 = '2026-11-11T10:00:00.000Z'
const T3 = '2026-11-12T10:00:00.000Z'
const NOW = new Date('2026-11-17T12:00:00.000Z')

function makeJob(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    dedupeKey: `dk-${id}`,
    source: 'greenhouse',
    sourceJobId: `sj-${id}`,
    companySlug: 'acme',
    company: 'Acme',
    title: `Engineer ${id}`,
    url: `https://example.com/jobs/${id}`,
    applyUrl: `https://example.com/jobs/${id}/apply`,
    locationText: 'Toronto, ON',
    country: 'CA',
    workplaceType: 'remote',
    eligibility: 'remote_canada_ok',
    salary: null,
    descriptionHtml: '<p>Build things</p>',
    descriptionText: 'Build things',
    postedAt: null,
    updatedAt: null,
    contentHash: `h-${id}`,
    ...overrides,
  }
}

interface RunInput {
  runId: string
  createdAt: string
  /** jobs.jsonl: the new and changed jobs. */
  jobs?: Job[]
  /** open.json jobs: every job the run sees as open. Defaults to `jobs`. */
  open?: Job[]
  completeCompanies?: string[]
  reportJson?: string | null
}

function runData(r: RunInput): RunData {
  const sent = r.jobs ?? []
  const open = r.open ?? sent
  return {
    runId: r.runId,
    createdAt: r.createdAt,
    jobs: sent,
    open: {
      runId: r.runId,
      generatedAt: r.createdAt,
      completeCompanies: r.completeCompanies ?? [...new Set(open.map((j) => j.companySlug))],
      jobs: open.map((j) => ({ id: j.id, contentHash: j.contentHash, companySlug: j.companySlug })),
    },
    reportJson: r.reportJson ?? null,
  }
}

function runFiles(r: RunInput): Record<string, string> {
  const data = runData(r)
  const files: Record<string, string> = {
    'jobs.jsonl': data.jobs.map((j) => JSON.stringify(j)).join('\n'),
    'open.json': JSON.stringify(data.open),
  }
  if (data.reportJson !== null) files['report.json'] = data.reportJson
  return files
}

function jobRow(db: Db, id: string) {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()
}

function runRow(db: Db, runId: string) {
  return db.select().from(ingestRuns).where(eq(ingestRuns.runId, runId)).get()
}

interface FakeRun {
  run: RunnerRun
  /** Omit for a run without an ingest artifact (e.g. a dry run). */
  files?: Record<string, string>
  expired?: boolean
}

function fakeSource(listed: FakeRun[]) {
  const byId = new Map(listed.map((f) => [f.run.id, f]))
  const byUrl = new Map(listed.map((f) => [`dl://${f.run.id}`, f]))
  const listRuns = vi.fn<RunSource['listRuns']>(() => Promise.resolve(listed.map((f) => f.run)))
  const listArtifacts = vi.fn<RunSource['listArtifacts']>((runId) => {
    const f = byId.get(runId)
    const artifacts: RunArtifact[] = [
      { name: 'logs', expired: false, downloadUrl: `dl://logs-${runId}` },
    ]
    if (f?.files !== undefined || f?.expired === true) {
      artifacts.push({
        name: `ingest-${runId}`,
        expired: f.expired ?? false,
        downloadUrl: `dl://${runId}`,
      })
    }
    return Promise.resolve(artifacts)
  })
  const downloadArtifact = vi.fn<RunSource['downloadArtifact']>((artifact) => {
    const files = byUrl.get(artifact.downloadUrl)?.files
    if (files === undefined) return Promise.reject(new Error(`no files at ${artifact.downloadUrl}`))
    return Promise.resolve(files)
  })
  const source: RunSource = { listRuns, listArtifacts, downloadArtifact }
  return { source, listRuns, listArtifacts, downloadArtifact }
}

const versionedJob = (n: number) => makeJob('a1', { title: `v${n}`, contentHash: `h${n}` })

const runnerRun = (id: string, createdAt: string): RunnerRun => ({
  id,
  createdAt,
  url: `https://github.com/o/r/actions/runs/${id}`,
})

// ---------- applyRun ----------

describe('applyRun', () => {
  it('inserts jobs into an empty DB and records the run', () => {
    const db = openDb(':memory:')
    const counts = applyRun(
      db,
      runData({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1'), makeJob('a2')] }),
      NOW,
    )

    expect(counts).toEqual({
      received: 2,
      inserted: 2,
      updated: 0,
      closed: 0,
      reopened: 0,
      missing: 0,
    })
    const a1 = jobRow(db, 'a1')
    expect(a1).toMatchObject({
      title: 'Engineer a1',
      firstSeenAt: T1,
      lastSeenAt: T1,
      closedAt: null,
      lastRunId: 'r1',
      status: 'new',
      notes: null,
    })
    expect(db.select().from(jobs).all()).toHaveLength(2)
    expect(runRow(db, 'r1')).toMatchObject({
      runCreatedAt: T1,
      syncedAt: NOW.toISOString(),
      outcome: 'synced',
      received: 2,
      inserted: 2,
      updated: 0,
      closed: 0,
      reopened: 0,
      missing: 0,
    })
  })

  it('counts changed jobs as updated, ignores unchanged ones, and keeps local fields', () => {
    const db = openDb(':memory:')
    applyRun(db, runData({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1'), makeJob('a2')] }), NOW)
    db.update(jobs)
      .set({ status: 'applied', notes: 'Talked to Sam' })
      .where(eq(jobs.id, 'a1'))
      .run()

    const changed = makeJob('a1', { contentHash: 'h-a1-v2', title: 'Senior Engineer' })
    const counts = applyRun(
      db,
      // Full resend: a2 comes again with the same hash.
      runData({ runId: 'r2', createdAt: T2, jobs: [changed, makeJob('a2')] }),
      NOW,
    )

    expect(counts).toMatchObject({ received: 2, inserted: 0, updated: 1, closed: 0, reopened: 0 })
    expect(jobRow(db, 'a1')).toMatchObject({
      title: 'Senior Engineer',
      contentHash: 'h-a1-v2',
      firstSeenAt: T1,
      lastSeenAt: T2,
      lastRunId: 'r2',
      status: 'applied',
      notes: 'Talked to Sam',
    })
    expect(jobRow(db, 'a2')).toMatchObject({ firstSeenAt: T1, lastSeenAt: T2, status: 'new' })
    expect(runRow(db, 'r2')).toMatchObject({ outcome: 'synced', inserted: 0, updated: 1 })
  })

  it('updates lastSeenAt for open jobs that were not resent', () => {
    const db = openDb(':memory:')
    const a1 = makeJob('a1')
    applyRun(db, runData({ runId: 'r1', createdAt: T1, jobs: [a1] }), NOW)
    const counts = applyRun(db, runData({ runId: 'r2', createdAt: T2, jobs: [], open: [a1] }), NOW)

    expect(counts).toEqual({
      received: 0,
      inserted: 0,
      updated: 0,
      closed: 0,
      reopened: 0,
      missing: 0,
    })
    expect(jobRow(db, 'a1')).toMatchObject({ firstSeenAt: T1, lastSeenAt: T2, closedAt: null })
  })

  it('closes jobs of completely fetched companies that are no longer listed', () => {
    const db = openDb(':memory:')
    const a1 = makeJob('a1')
    const a2 = makeJob('a2')
    const b1 = makeJob('b1', { companySlug: 'beta', company: 'Beta' })
    applyRun(db, runData({ runId: 'r1', createdAt: T1, jobs: [a1, a2, b1] }), NOW)

    // acme was fetched completely and no longer lists a2; beta's fetch failed, so it lists nothing.
    const counts = applyRun(
      db,
      runData({ runId: 'r2', createdAt: T2, jobs: [], open: [a1], completeCompanies: ['acme'] }),
      NOW,
    )

    expect(counts.closed).toBe(1)
    expect(jobRow(db, 'a2')?.closedAt).toBe(T2)
    expect(jobRow(db, 'a1')?.closedAt).toBeNull()
    expect(jobRow(db, 'b1')?.closedAt).toBeNull()
    expect(runRow(db, 'r2')?.closed).toBe(1)
  })

  it('does not move closedAt of an already closed job', () => {
    const db = openDb(':memory:')
    const a1 = makeJob('a1')
    applyRun(db, runData({ runId: 'r1', createdAt: T1, jobs: [a1, makeJob('a2')] }), NOW)
    applyRun(db, runData({ runId: 'r2', createdAt: T2, open: [a1], completeCompanies: ['acme'] }))
    const counts = applyRun(
      db,
      runData({ runId: 'r3', createdAt: T3, open: [a1], completeCompanies: ['acme'] }),
      NOW,
    )

    expect(counts.closed).toBe(0)
    expect(jobRow(db, 'a2')?.closedAt).toBe(T2)
  })

  it('reopens a closed job that is listed again', () => {
    const db = openDb(':memory:')
    const a1 = makeJob('a1')
    const a2 = makeJob('a2')
    applyRun(db, runData({ runId: 'r1', createdAt: T1, jobs: [a1, a2] }), NOW)
    applyRun(db, runData({ runId: 'r2', createdAt: T2, open: [a1], completeCompanies: ['acme'] }))
    expect(jobRow(db, 'a2')?.closedAt).toBe(T2)

    const counts = applyRun(
      db,
      runData({ runId: 'r3', createdAt: T3, open: [a1, a2], completeCompanies: ['acme'] }),
      NOW,
    )

    expect(counts).toMatchObject({ reopened: 1, closed: 0, missing: 0 })
    expect(jobRow(db, 'a2')).toMatchObject({ closedAt: null, firstSeenAt: T1, lastSeenAt: T3 })
    expect(runRow(db, 'r3')?.reopened).toBe(1)
  })

  it('reopens a job listed again even when its company fetch was not complete', () => {
    const db = openDb(':memory:')
    const a1 = makeJob('a1')
    applyRun(db, runData({ runId: 'r1', createdAt: T1, jobs: [a1] }), NOW)
    applyRun(db, runData({ runId: 'r2', createdAt: T2, open: [], completeCompanies: ['acme'] }))
    const counts = applyRun(
      db,
      runData({ runId: 'r3', createdAt: T3, open: [a1], completeCompanies: [] }),
      NOW,
    )

    expect(counts.reopened).toBe(1)
    expect(jobRow(db, 'a1')?.closedAt).toBeNull()
  })

  it('counts listed jobs that are not in the DB as missing', () => {
    const db = openDb(':memory:')
    const a1 = makeJob('a1')
    applyRun(db, runData({ runId: 'r1', createdAt: T1, jobs: [a1] }), NOW)

    // A missed run sent x1 and x2; this run lists them but doesn't resend them.
    const counts = applyRun(
      db,
      runData({
        runId: 'r2',
        createdAt: T2,
        jobs: [],
        open: [a1, makeJob('x1'), makeJob('x2')],
      }),
      NOW,
    )

    expect(counts.missing).toBe(2)
    expect(jobRow(db, 'x1')).toBeUndefined()
    expect(runRow(db, 'r2')?.missing).toBe(2)
  })

  it('stores report.json and upserts company statuses', () => {
    const db = openDb(':memory:')
    const report1 = JSON.stringify({
      generatedAt: T1,
      companies: [
        {
          slug: 'acme',
          name: 'Acme',
          ats: 'greenhouse',
          status: 'ok',
          complete: true,
          fetched: 12,
          kept: 3,
        },
        {
          slug: 'beta',
          name: 'Beta',
          ats: 'lever',
          status: 'error',
          complete: false,
          fetched: 0,
          kept: 0,
          error: 'HTTP 500',
        },
      ],
    })
    applyRun(
      db,
      runData({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1')], reportJson: report1 }),
      NOW,
    )

    expect(runRow(db, 'r1')?.report).toBe(report1)
    expect(db.select().from(companies).orderBy(companies.slug).all()).toEqual([
      {
        slug: 'acme',
        name: 'Acme',
        ats: 'greenhouse',
        lastRunId: 'r1',
        lastRunAt: T1,
        lastStatus: 'ok',
        lastComplete: true,
        lastFetched: 12,
        lastKept: 3,
        lastError: null,
      },
      {
        slug: 'beta',
        name: 'Beta',
        ats: 'lever',
        lastRunId: 'r1',
        lastRunAt: T1,
        lastStatus: 'error',
        lastComplete: false,
        lastFetched: 0,
        lastKept: 0,
        lastError: 'HTTP 500',
      },
    ])

    const report2 = JSON.stringify({
      companies: [
        {
          slug: 'beta',
          name: 'Beta Inc',
          ats: 'lever',
          status: 'ok',
          complete: true,
          fetched: 4,
          kept: 1,
        },
      ],
    })
    applyRun(db, runData({ runId: 'r2', createdAt: T2, reportJson: report2 }), NOW)

    const beta = db.select().from(companies).where(eq(companies.slug, 'beta')).get()
    expect(beta).toMatchObject({
      name: 'Beta Inc',
      lastRunId: 'r2',
      lastRunAt: T2,
      lastStatus: 'ok',
      lastComplete: true,
      lastFetched: 4,
      lastKept: 1,
      lastError: null,
    })
    expect(db.select().from(companies).where(eq(companies.slug, 'acme')).get()?.lastRunId).toBe(
      'r1',
    )
  })

  it.each([
    ['malformed', '{not json'],
    ['the wrong shape', JSON.stringify({ companies: [{ slug: 'acme' }] })],
  ])('still applies a run whose report.json is %s', (_, reportJson) => {
    const db = openDb(':memory:')
    const run = runData({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1')], reportJson })

    expect(() => applyRun(db, run, NOW)).not.toThrow()
    expect(jobRow(db, 'a1')).toBeDefined()
    expect(runRow(db, 'r1')).toMatchObject({ outcome: 'synced', report: reportJson })
    expect(db.select().from(companies).all()).toEqual([])
  })
})

// ---------- parseRunFiles ----------

describe('parseRunFiles', () => {
  it('parses the three artifact files', () => {
    const files = runFiles({
      runId: 'r1',
      createdAt: T1,
      jobs: [makeJob('a1'), makeJob('a2')],
      reportJson: '{"companies":[]}',
    })
    const run = parseRunFiles('r1', T1, files)

    expect(run.runId).toBe('r1')
    expect(run.createdAt).toBe(T1)
    expect(run.jobs.map((j) => j.id)).toEqual(['a1', 'a2'])
    expect(run.open.completeCompanies).toEqual(['acme'])
    expect(run.reportJson).toBe('{"companies":[]}')
  })

  it('accepts a missing jobs.jsonl and blank lines', () => {
    const files = runFiles({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1')] })
    files['jobs.jsonl'] = `\n${files['jobs.jsonl']}\n\n`
    expect(parseRunFiles('r1', T1, files).jobs).toHaveLength(1)

    delete files['jobs.jsonl']
    expect(parseRunFiles('r1', T1, files).jobs).toEqual([])
  })

  it('throws a clear error when open.json is missing', () => {
    const files = runFiles({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1')] })
    delete files['open.json']
    expect(() => parseRunFiles('r1', T1, files)).toThrow('Run r1: artifact has no open.json')
  })

  it('throws a clear error on an invalid job line', () => {
    const bad = { ...makeJob('a2'), url: 'javascript:alert(1)' }
    const files = runFiles({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1')] })
    files['jobs.jsonl'] = [files['jobs.jsonl'], JSON.stringify(bad)].join('\n')

    expect(() => parseRunFiles('r1', T1, files)).toThrow(
      "Run r1: jobs.jsonl line 2 isn't a valid job",
    )
  })
})

// ---------- sync ----------

describe('sync', () => {
  it('applies runs oldest first whatever order they are listed in', async () => {
    const db = openDb(':memory:')
    const { source, downloadArtifact } = fakeSource([
      {
        run: runnerRun('r3', T3),
        files: runFiles({ runId: 'r3', createdAt: T3, jobs: [versionedJob(3)] }),
      },
      {
        run: runnerRun('r1', T1),
        files: runFiles({ runId: 'r1', createdAt: T1, jobs: [versionedJob(1)] }),
      },
      {
        run: runnerRun('r2', T2),
        files: runFiles({ runId: 'r2', createdAt: T2, jobs: [versionedJob(2)] }),
      },
    ])

    const result = await sync(db, source, () => NOW)

    expect(result.gap).toBe(false)
    expect(result.runs.map((r) => [r.runId, r.outcome])).toEqual([
      ['r1', 'synced'],
      ['r2', 'synced'],
      ['r3', 'synced'],
    ])
    expect(result.runs[0]).toMatchObject({
      createdAt: T1,
      url: 'https://github.com/o/r/actions/runs/r1',
      inserted: 1,
    })
    expect(result.runs[1]).toMatchObject({ inserted: 0, updated: 1 })
    expect(downloadArtifact.mock.calls.map(([a]) => a.downloadUrl)).toEqual([
      'dl://r1',
      'dl://r2',
      'dl://r3',
    ])
    expect(jobRow(db, 'a1')).toMatchObject({
      title: 'v3',
      firstSeenAt: T1,
      lastSeenAt: T3,
      lastRunId: 'r3',
    })
  })

  it('records a run without an ingest artifact as no_artifact', async () => {
    const db = openDb(':memory:')
    const { source, downloadArtifact } = fakeSource([{ run: runnerRun('r1', T1) }])

    const result = await sync(db, source, () => NOW)

    expect(result).toEqual({
      gap: false,
      runs: [
        {
          runId: 'r1',
          createdAt: T1,
          outcome: 'no_artifact',
          url: 'https://github.com/o/r/actions/runs/r1',
        },
      ],
    })
    expect(downloadArtifact).not.toHaveBeenCalled()
    expect(runRow(db, 'r1')).toMatchObject({
      runCreatedAt: T1,
      syncedAt: NOW.toISOString(),
      outcome: 'no_artifact',
      received: 0,
    })
  })

  it('records an expired artifact and reports a gap', async () => {
    const db = openDb(':memory:')
    const { source, downloadArtifact } = fakeSource([
      { run: runnerRun('r1', T1), expired: true },
      { run: runnerRun('r2', T2), files: runFiles({ runId: 'r2', createdAt: T2, jobs: [] }) },
    ])

    const result = await sync(db, source, () => NOW)

    expect(result.gap).toBe(true)
    expect(result.runs.map((r) => [r.runId, r.outcome])).toEqual([
      ['r1', 'expired'],
      ['r2', 'synced'],
    ])
    expect(downloadArtifact).toHaveBeenCalledTimes(1)
    expect(runRow(db, 'r1')?.outcome).toBe('expired')
  })

  it('reports a gap when a run lists jobs that are not in the DB', async () => {
    const db = openDb(':memory:')
    const { source } = fakeSource([
      {
        run: runnerRun('r1', T1),
        files: runFiles({ runId: 'r1', createdAt: T1, jobs: [], open: [makeJob('x1')] }),
      },
    ])

    const result = await sync(db, source, () => NOW)

    expect(result.gap).toBe(true)
    expect(result.runs[0]).toMatchObject({ outcome: 'synced', missing: 1 })
  })

  it('skips a run older than one already synced as superseded', async () => {
    const db = openDb(':memory:')
    const r1 = {
      run: runnerRun('r1', T1),
      files: runFiles({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1', { title: 'old' })] }),
    }
    const r2 = {
      run: runnerRun('r2', T2),
      files: runFiles({ runId: 'r2', createdAt: T2, jobs: [makeJob('a1', { title: 'new' })] }),
    }

    // The first sync only sees r2; r1 shows up later (e.g. it was slow to finish).
    await sync(db, fakeSource([r2]).source, () => NOW)
    const later = fakeSource([r2, r1])
    const result = await sync(db, later.source, () => NOW)

    expect(result.runs).toEqual([
      {
        runId: 'r1',
        createdAt: T1,
        outcome: 'superseded',
        url: 'https://github.com/o/r/actions/runs/r1',
      },
    ])
    expect(later.listArtifacts).not.toHaveBeenCalled()
    expect(later.downloadArtifact).not.toHaveBeenCalled()
    expect(runRow(db, 'r1')?.outcome).toBe('superseded')
    expect(jobRow(db, 'a1')).toMatchObject({ title: 'new', lastRunId: 'r2' })
  })

  it('changes nothing when run twice', async () => {
    const db = openDb(':memory:')
    const { source, listRuns, listArtifacts, downloadArtifact } = fakeSource([
      {
        run: runnerRun('r2', T2),
        files: runFiles({ runId: 'r2', createdAt: T2, jobs: [makeJob('a2')] }),
      },
      {
        run: runnerRun('r1', T1),
        files: runFiles({ runId: 'r1', createdAt: T1, jobs: [makeJob('a1')] }),
      },
      { run: runnerRun('r0', '2026-11-09T10:00:00.000Z') },
    ])

    const first = await sync(db, source, () => NOW)
    expect(first.runs).toHaveLength(3)
    const runsAfterFirst = db.select().from(ingestRuns).orderBy(ingestRuns.runId).all()
    const jobsAfterFirst = db.select().from(jobs).orderBy(jobs.id).all()
    expect(listArtifacts).toHaveBeenCalledTimes(3)
    expect(downloadArtifact).toHaveBeenCalledTimes(2)

    const second = await sync(db, source, () => new Date('2026-11-18T00:00:00.000Z'))

    expect(second).toEqual({ runs: [], gap: false })
    expect(listRuns).toHaveBeenCalledTimes(2)
    expect(listArtifacts).toHaveBeenCalledTimes(3)
    expect(downloadArtifact).toHaveBeenCalledTimes(2)
    expect(db.select().from(ingestRuns).orderBy(ingestRuns.runId).all()).toEqual(runsAfterFirst)
    expect(db.select().from(jobs).orderBy(jobs.id).all()).toEqual(jobsAfterFirst)
  })
})

// ---------- syncFromDir ----------

describe('syncFromDir', () => {
  it('applies a local ingest output once', async () => {
    const db = openDb(':memory:')
    const dir = await mkdtemp(join(tmpdir(), 'lantern-sync-'))
    const files = runFiles({
      runId: 'local-1',
      createdAt: T1,
      jobs: [makeJob('a1'), makeJob('a2')],
      reportJson: JSON.stringify({
        companies: [
          {
            slug: 'acme',
            name: 'Acme',
            ats: 'greenhouse',
            status: 'ok',
            complete: true,
            fetched: 2,
            kept: 2,
          },
        ],
      }),
    })
    await Promise.all(
      Object.entries(files).map(([name, text]) => writeFile(join(dir, name), text, 'utf8')),
    )

    const first = await syncFromDir(db, dir, NOW)

    expect(first).toEqual({
      runId: 'local-1',
      createdAt: T1,
      outcome: 'synced',
      received: 2,
      inserted: 2,
      updated: 0,
      closed: 0,
      reopened: 0,
      missing: 0,
    })
    expect(jobRow(db, 'a1')).toMatchObject({ firstSeenAt: T1, lastRunId: 'local-1' })
    expect(db.select().from(companies).all()).toHaveLength(1)
    const runsAfterFirst = db.select().from(ingestRuns).all()
    const jobsAfterFirst = db.select().from(jobs).orderBy(jobs.id).all()

    const second = await syncFromDir(db, dir, new Date('2026-11-18T00:00:00.000Z'))

    expect(second).toEqual({ runId: 'local-1', createdAt: T1, outcome: 'synced' })
    expect(db.select().from(ingestRuns).all()).toEqual(runsAfterFirst)
    expect(db.select().from(jobs).orderBy(jobs.id).all()).toEqual(jobsAfterFirst)
  })
})

describe('readable errors', () => {
  it('names the run and line for a jobs.jsonl line that is not JSON', () => {
    const open = JSON.stringify({
      runId: 'r9',
      generatedAt: '2026-11-17T00:00:00.000Z',
      completeCompanies: [],
      jobs: [],
    })
    expect(() =>
      parseRunFiles('r9', '2026-11-17T00:00:00.000Z', { 'open.json': open, 'jobs.jsonl': '{oops' }),
    ).toThrow("Run r9: jobs.jsonl line 1 isn't a valid job")
    expect(() => parseRunFiles('r9', '2026-11-17T00:00:00.000Z', { 'open.json': '{oops' })).toThrow(
      "Run r9: open.json isn't in the expected format",
    )
  })

  it('explains a folder without ingest output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lantern-empty-'))
    await expect(syncFromDir(openDb(':memory:'), dir)).rejects.toThrow('not an ingest output')
  })
})
