import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { Job } from '#/pipeline/schema'
import { applyRun, type RunData } from '#/sync/sync'

import { openDb, type Db } from '../index'
import { jobs, tailoredResumes } from '../schema'
import {
  getTailoring,
  insertTailoring,
  latestTailoring,
  listTailorings,
  setAppliedResume,
  setDecision,
  type NewTailoring,
} from '../tailored'

function addJob(db: Db, id: string) {
  const at = '2026-11-10T10:00:00.000Z'
  db.insert(jobs)
    .values({
      id,
      dedupeKey: id,
      source: 'ashby',
      sourceJobId: id,
      companySlug: 'acme',
      company: 'Acme',
      title: 'Frontend Engineer',
      url: 'https://example.com/job',
      locationText: 'Remote',
      eligibility: 'remote_canada_ok',
      descriptionHtml: '',
      descriptionText: '',
      contentHash: 'h',
      firstSeenAt: at,
      lastSeenAt: at,
      lastRunId: 'r1',
    })
    .run()
}

function tailoring(jobId: string, extra: Partial<NewTailoring> = {}): NewTailoring {
  return {
    jobId,
    model: 'test-model',
    resumeHash: 'rh',
    jobHash: 'jh',
    tailoring: { summary: 'Hi' },
    checks: [],
    ...extra,
  }
}

function syncJob(contentHash: string): Job {
  return {
    id: 'j1',
    dedupeKey: 'dk-j1',
    source: 'greenhouse',
    sourceJobId: 'sj-j1',
    companySlug: 'acme',
    company: 'Acme',
    title: 'Engineer',
    url: 'https://example.com/jobs/j1',
    applyUrl: null,
    locationText: 'Toronto, ON',
    country: 'CA',
    workplaceType: 'remote',
    eligibility: 'remote_canada_ok',
    salary: null,
    descriptionHtml: '<p>Build things</p>',
    descriptionText: 'Build things',
    postedAt: null,
    updatedAt: null,
    contentHash,
  }
}

function runWith(runId: string, createdAt: string, j: Job): RunData {
  return {
    runId,
    createdAt,
    jobs: [j],
    open: {
      runId,
      generatedAt: createdAt,
      completeCompanies: ['acme'],
      jobs: [{ id: j.id, contentHash: j.contentHash, companySlug: j.companySlug }],
    },
    reportJson: null,
  }
}

function setup(...ids: string[]): Db {
  const db = openDb(':memory:')
  for (const id of ids) addJob(db, id)
  return db
}

describe('tailored resumes', () => {
  it('counts versions up per job, independently across jobs', () => {
    const db = setup('a', 'b')
    expect(insertTailoring(db, tailoring('a')).version).toBe(1)
    expect(insertTailoring(db, tailoring('a')).version).toBe(2)
    expect(insertTailoring(db, tailoring('b')).version).toBe(1)
    expect(insertTailoring(db, tailoring('a')).version).toBe(3)
  })

  it('lists newest first and finds the latest', () => {
    const db = setup('a', 'b')
    for (let i = 0; i < 3; i++) insertTailoring(db, tailoring('a'))
    expect(listTailorings(db, 'a').map((t) => t.version)).toEqual([3, 2, 1])
    expect(latestTailoring(db, 'a')?.version).toBe(3)
    expect(listTailorings(db, 'b')).toEqual([])
    expect(latestTailoring(db, 'b')).toBeUndefined()
  })

  it('round-trips JSON through getTailoring', () => {
    const db = setup('a')
    const created = insertTailoring(
      db,
      tailoring('a', {
        tailoring: { bullets: ['x', 'y'], nested: { n: 1 } },
        checks: [{ ok: true }],
        usage: { inputTokens: 10 },
        promptHash: 'ph',
        createdAt: '2026-11-18T00:00:00.000Z',
      }),
    )
    expect(getTailoring(db, created.id)).toEqual({
      id: created.id,
      jobId: 'a',
      version: 1,
      createdAt: '2026-11-18T00:00:00.000Z',
      model: 'test-model',
      resumeHash: 'rh',
      jobHash: 'jh',
      promptHash: 'ph',
      tailoring: { bullets: ['x', 'y'], nested: { n: 1 } },
      checks: [{ ok: true }],
      decisions: {},
      usage: { inputTokens: 10 },
    })
    expect(getTailoring(db, created.id + 100)).toBeUndefined()
    // Versions saved without a prompt hash (from before prompts were editable) read as null.
    expect(insertTailoring(db, tailoring('a')).promptHash).toBeNull()
  })

  it('accumulates decisions and ignores a missing id', () => {
    const db = setup('a')
    const { id } = insertTailoring(db, tailoring('a'))
    expect(setDecision(db, id, 'summary', true)?.decisions).toEqual({ summary: true })
    expect(setDecision(db, id, 'bullet-1', false)?.decisions).toEqual({
      summary: true,
      'bullet-1': false,
    })
    expect(setDecision(db, id, 'summary', false)?.decisions).toEqual({
      summary: false,
      'bullet-1': false,
    })
    expect(getTailoring(db, id)?.decisions).toEqual({ summary: false, 'bullet-1': false })
    expect(setDecision(db, id + 100, 'summary', true)).toBeUndefined()
  })

  it('reads corrupt JSON as empty decisions and null data', () => {
    const db = setup('a')
    const { id } = insertTailoring(db, tailoring('a'))
    db.update(tailoredResumes)
      .set({ decisions: '{not json', tailoring: 'nope' })
      .where(eq(tailoredResumes.id, id))
      .run()
    expect(getTailoring(db, id)).toMatchObject({ decisions: {}, tailoring: null })
    db.update(tailoredResumes)
      .set({ decisions: '{"a": "yes"}' })
      .where(eq(tailoredResumes.id, id))
      .run()
    expect(getTailoring(db, id)?.decisions).toEqual({})
    expect(setDecision(db, id, 'b', true)?.decisions).toEqual({ b: true })
  })

  it('sets and clears the applied resume', () => {
    const db = setup('a')
    const { id } = insertTailoring(db, tailoring('a'))
    const applied = () =>
      db.select({ v: jobs.appliedResumeId }).from(jobs).where(eq(jobs.id, 'a')).get()?.v
    expect(setAppliedResume(db, 'a', id)).toBe(true)
    expect(applied()).toBe(id)
    expect(setAppliedResume(db, 'a', null)).toBe(true)
    expect(applied()).toBeNull()
    expect(setAppliedResume(db, 'missing', id)).toBe(false)
  })

  it('is left alone by sync', () => {
    const db = openDb(':memory:')
    applyRun(db, runWith('r1', '2026-11-10T10:00:00.000Z', syncJob('h1')))
    const { id } = insertTailoring(db, tailoring('j1'))
    setAppliedResume(db, 'j1', id)
    const counts = applyRun(db, runWith('r2', '2026-11-11T10:00:00.000Z', syncJob('h2')))
    expect(counts.updated).toBe(1)

    const row = db.select().from(jobs).where(eq(jobs.id, 'j1')).get()
    expect(row).toMatchObject({ contentHash: 'h2', appliedResumeId: id })
  })
})
