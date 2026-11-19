import { describe, expect, it } from 'vitest'

import { openDb, type Db } from '../index'
import { inboxCount, setJobStatus } from '../jobs'
import { jobs } from '../schema'

function addJob(db: Db, id: string, closedAt: string | null = null) {
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
      closedAt,
      lastRunId: 'r1',
    })
    .run()
}

describe('job status', () => {
  it('moves jobs out of the inbox, and counts only open inbox jobs', () => {
    const db = openDb(':memory:')
    addJob(db, 'a')
    addJob(db, 'b')
    addJob(db, 'closed', '2026-11-11T10:00:00.000Z')
    expect(inboxCount(db)).toBe(2)

    expect(setJobStatus(db, 'a', 'dismissed')).toBe(true)
    expect(inboxCount(db)).toBe(1)
    expect(setJobStatus(db, 'a', 'new')).toBe(true)
    expect(inboxCount(db)).toBe(2)
  })

  it('reports a job that is not there', () => {
    expect(setJobStatus(openDb(':memory:'), 'missing', 'applied')).toBe(false)
  })
})
