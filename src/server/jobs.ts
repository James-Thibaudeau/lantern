import { createServerFn } from '@tanstack/react-start'
import { desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { setJobStatus as updateJobStatus } from '#/db/jobs'
import { ingestRuns, jobs, type JobRowDb } from '#/db/schema'
import {
  EligibilitySchema,
  JobStatusSchema,
  SalarySchema,
  type Eligibility,
  type JobStatus,
  type Salary,
} from '#/pipeline/schema'
import type { JobScore, Reason, ScorableJob } from '#/rank/score'

import { getDb, rankingStatus, runSync, startupSync } from './db'

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
  status: JobStatus
  /** Null when there are no ranking criteria. */
  score: number | null
  reasons: Reason[]
  dealbreaker: string | null
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
  /** Whether jobs are ranked, and with what criteria (one line for the UI). */
  ranking: { ranked: boolean; ok: boolean; message: string }
}

function toRow(j: JobRowDb, score: ((job: ScorableJob) => JobScore) | null): JobRow {
  const s = score?.(j)
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
    status: JobStatusSchema.catch('new').parse(j.status),
    score: s?.score ?? null,
    reasons: s?.reasons ?? [],
    dealbreaker: s?.dealbreaker ?? null,
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
    await startupSync()
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

    const ranking = rankingStatus()
    return {
      jobs: rows.map((j) => toRow(j, ranking.score)),
      lastRun: latest ? { runId: latest.runId, at: latest.at, totals } : null,
      ranking: { ranked: ranking.score !== null, ok: ranking.ok, message: ranking.message },
    }
  })

/** The Sync button. */
export const syncNow = createServerFn({ method: 'POST' }).handler(() => runSync())

const SetStatusInput = z.object({ id: z.string().min(1), status: JobStatusSchema })

/** Interested / Applied / Dismiss (and back to the inbox). */
export const setJobStatus = createServerFn({ method: 'POST' })
  .validator((input: unknown) => SetStatusInput.parse(input))
  .handler(({ data }): { ok: boolean; message: string } =>
    updateJobStatus(getDb(), data.id, data.status)
      ? { ok: true, message: 'Saved.' }
      : { ok: false, message: 'That job is no longer in the database. Try Sync.' },
  )
