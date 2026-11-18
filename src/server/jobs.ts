import { createServerFn } from '@tanstack/react-start'
import { desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { ingestRuns, jobs, type JobRowDb } from '#/db/schema'
import { EligibilitySchema, SalarySchema, type Eligibility, type Salary } from '#/pipeline/schema'

import { getDb, runSync, startupSync, type SyncStatus } from './db'

/** What the jobs page needs per job (everything except the heavy HTML description). */
export interface JobRow {
  id: string
  source: string
  company: string
  companySlug: string
  title: string
  url: string
  applyUrl: string | null
  locationText: string
  eligibility: Eligibility
  salary: Salary | null
  descriptionText: string
  postedAt: string | null
  firstSeenAt: string
  closedAt: string | null
}

const RunTotals = z.object({
  totals: z.object({
    ok: z.number(),
    companies: z.number(),
    fetched: z.number(),
    kept: z.number(),
  }),
})

export interface JobsData {
  jobs: JobRow[]
  lastRun: { runId: string; at: string; totals: z.infer<typeof RunTotals>['totals'] | null } | null
  /** Result of the sync that runs when the app starts (or the latest Sync click). */
  sync: SyncStatus
}

function toRow(j: JobRowDb): JobRow {
  const salary = SalarySchema.safeParse({
    min: j.salaryMin,
    max: j.salaryMax,
    currency: j.salaryCurrency,
    period: j.salaryPeriod,
  }).data
  return {
    id: j.id,
    source: j.source,
    company: j.company,
    companySlug: j.companySlug,
    title: j.title,
    url: j.url,
    applyUrl: j.applyUrl,
    locationText: j.locationText,
    eligibility: EligibilitySchema.catch('unknown').parse(j.eligibility),
    salary: salary && (salary.min !== null || salary.max !== null) ? salary : null,
    descriptionText: j.descriptionText,
    postedAt: j.postedAt,
    firstSeenAt: j.firstSeenAt,
    closedAt: j.closedAt,
  }
}

/**
 * A server function: the handler only runs on the server (so it can use SQLite), and
 * TanStack Start turns calls from the browser into an HTTP request.
 */
export const getJobs = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ closed: z.boolean() }).parse(input))
  .handler(async ({ data }): Promise<JobsData> => {
    // The first page load after the app starts waits for a sync, so it shows fresh data.
    const status = await startupSync()
    const db = getDb()

    const rows = db
      .select()
      .from(jobs)
      .where(data.closed ? undefined : isNull(jobs.closedAt))
      .orderBy(desc(jobs.firstSeenAt), desc(jobs.postedAt))
      .all()

    const latest = db
      .select({ runId: ingestRuns.runId, at: ingestRuns.runCreatedAt, report: ingestRuns.report })
      .from(ingestRuns)
      .where(eq(ingestRuns.outcome, 'synced'))
      .orderBy(desc(ingestRuns.runCreatedAt))
      .limit(1)
      .get()
    let totals = null
    try {
      totals = latest?.report
        ? (RunTotals.safeParse(JSON.parse(latest.report)).data?.totals ?? null)
        : null
    } catch {
      totals = null
    }

    return {
      jobs: rows.map(toRow),
      lastRun: latest ? { runId: latest.runId, at: latest.at, totals } : null,
      sync: status,
    }
  })

/** The Sync button. */
export const syncNow = createServerFn({ method: 'POST' }).handler(() => runSync())
