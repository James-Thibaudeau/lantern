import { and, count, eq, isNull } from 'drizzle-orm'

import type { JobStatus } from '#/pipeline/schema'

import type { Db } from './index'
import { jobs } from './schema'

/** Sets your status for a job. Returns false when there's no job with that id. */
export function setJobStatus(db: Db, id: string, status: JobStatus): boolean {
  return db.update(jobs).set({ status }).where(eq(jobs.id, id)).run().changes > 0
}

/** Open jobs still waiting in the inbox (status `new`). */
export function inboxCount(db: Db): number {
  return (
    db
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.status, 'new'), isNull(jobs.closedAt)))
      .get()?.n ?? 0
  )
}
