import { createServerFn } from '@tanstack/react-start'
import { asc, desc } from 'drizzle-orm'
import { z } from 'zod'

import { companies, ingestRuns, type CompanyRow } from '#/db/schema'
import { githubRunner } from '#/sync/settings'

import { getDb } from './db'

export interface RunRow {
  runId: string
  runCreatedAt: string
  syncedAt: string
  outcome: string
  inserted: number
  updated: number
  closed: number
  reopened: number
  missing: number
}

export interface RunsData {
  runs: RunRow[]
  companies: CompanyRow[]
  repo: string | null
}

export const getRuns = createServerFn({ method: 'GET' }).handler(async (): Promise<RunsData> => {
  const db = getDb()
  const runs = db
    .select({
      runId: ingestRuns.runId,
      runCreatedAt: ingestRuns.runCreatedAt,
      syncedAt: ingestRuns.syncedAt,
      outcome: ingestRuns.outcome,
      inserted: ingestRuns.inserted,
      updated: ingestRuns.updated,
      closed: ingestRuns.closed,
      reopened: ingestRuns.reopened,
      missing: ingestRuns.missing,
    })
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.runCreatedAt))
    .limit(100)
    .all()
  const companyRows = db.select().from(companies).orderBy(asc(companies.slug)).all()
  let repo: string | null = null
  try {
    repo = (await githubRunner()).settings.repo
  } catch {
    repo = null
  }
  return { runs, companies: companyRows, repo }
})

const RunNowInput = z.object({ fullResend: z.boolean() })

/** "Run now" and "Full resend": start the runner workflow on GitHub. */
export const runNow = createServerFn({ method: 'POST' })
  .validator((input: unknown) => RunNowInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; message: string; url?: string }> => {
    try {
      const { runner } = await githubRunner()
      await runner.dispatch({ fullResend: data.fullResend })
      return {
        ok: true,
        message: `${data.fullResend ? 'Full resend' : 'Run'} started. It takes about a minute; then press Sync.`,
        url: runner.actionsUrl,
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
