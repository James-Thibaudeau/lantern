import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'

import type { Db } from '#/db'
import { companies, ingestRuns, jobs } from '#/db/schema'
import { JobSchema, type Job } from '#/pipeline/schema'

import type { RunSource } from './github'

// ---------- Artifact parsing ----------

const OpenListingSchema = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  completeCompanies: z.array(z.string()),
  jobs: z.array(z.object({ id: z.string(), contentHash: z.string(), companySlug: z.string() })),
})
export type OpenListing = z.infer<typeof OpenListingSchema>

const ReportCompaniesSchema = z.looseObject({
  companies: z.array(
    z.looseObject({
      slug: z.string(),
      name: z.string(),
      ats: z.string(),
      status: z.string(),
      complete: z.boolean(),
      fetched: z.number(),
      kept: z.number(),
      error: z.string().optional(),
    }),
  ),
})

export interface RunData {
  runId: string
  /** When the run happened; used for firstSeenAt, lastSeenAt and closedAt. */
  createdAt: string
  jobs: Job[]
  open: OpenListing
  /** report.json as text, stored for run history. */
  reportJson: string | null
}

/** Parses the three files of an ingest artifact. Throws if they're unusable. */
export function parseRunFiles(
  runId: string,
  createdAt: string,
  files: Record<string, string>,
): RunData {
  const openText = files['open.json']
  if (openText === undefined) throw new Error(`Run ${runId}: artifact has no open.json`)
  const open = OpenListingSchema.safeParse(parseJson(openText))
  if (!open.success) throw new Error(`Run ${runId}: open.json isn't in the expected format`)
  const parsedJobs = (files['jobs.jsonl'] ?? '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, i) => {
      const r = JobSchema.safeParse(parseJson(line))
      if (!r.success) throw new Error(`Run ${runId}: jobs.jsonl line ${i + 1} isn't a valid job`)
      return r.data
    })
  return {
    runId,
    createdAt,
    jobs: parsedJobs,
    open: open.data,
    reportJson: files['report.json'] ?? null,
  }
}

/** JSON.parse that returns undefined for invalid JSON, so callers report it in context. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// ---------- Applying one run ----------

export interface RunCounts {
  received: number
  inserted: number
  updated: number
  closed: number
  reopened: number
  missing: number
}

function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function sourceFields(j: Job) {
  return {
    dedupeKey: j.dedupeKey,
    source: j.source,
    sourceJobId: j.sourceJobId,
    companySlug: j.companySlug,
    company: j.company,
    title: j.title,
    url: j.url,
    applyUrl: j.applyUrl,
    locationText: j.locationText,
    country: j.country,
    workplaceType: j.workplaceType,
    eligibility: j.eligibility,
    salaryMin: j.salary?.min ?? null,
    salaryMax: j.salary?.max ?? null,
    salaryCurrency: j.salary?.currency ?? null,
    salaryPeriod: j.salary?.period ?? null,
    descriptionHtml: j.descriptionHtml,
    descriptionText: j.descriptionText,
    postedAt: j.postedAt,
    updatedAt: j.updatedAt,
    contentHash: j.contentHash,
  }
}

/**
 * Applies one run's results in a single transaction:
 * 1. upsert the new and updated jobs (never touching status or notes),
 * 2. close open local jobs of completely fetched companies that the run no longer lists,
 * 3. reopen closed jobs the run lists again,
 * 4. count listed jobs missing locally (a sign a run was missed),
 * 5. record the run and each company's latest status.
 */
export function applyRun(db: Db, run: RunData, now: Date = new Date()): RunCounts {
  const at = run.createdAt
  const counts: RunCounts = {
    received: run.jobs.length,
    inserted: 0,
    updated: 0,
    closed: 0,
    reopened: 0,
    missing: 0,
  }

  db.transaction((tx) => {
    for (const job of run.jobs) {
      const existing = tx
        .select({ contentHash: jobs.contentHash })
        .from(jobs)
        .where(eq(jobs.id, job.id))
        .get()
      if (!existing) {
        tx.insert(jobs)
          .values({
            id: job.id,
            ...sourceFields(job),
            firstSeenAt: at,
            lastSeenAt: at,
            lastRunId: run.runId,
          })
          .run()
        counts.inserted++
      } else {
        tx.update(jobs)
          .set({ ...sourceFields(job), lastSeenAt: at, lastRunId: run.runId })
          .where(eq(jobs.id, job.id))
          .run()
        if (existing.contentHash !== job.contentHash) counts.updated++
      }
    }

    const openIds = new Set(run.open.jobs.map((j) => j.id))

    // Closed: only for companies this run fetched completely, so a failed fetch never
    // closes anything.
    if (run.open.completeCompanies.length > 0) {
      const stillOpen = tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(inArray(jobs.companySlug, run.open.completeCompanies), isNull(jobs.closedAt)))
        .all()
      const toClose = stillOpen.map((r) => r.id).filter((id) => !openIds.has(id))
      for (const ids of chunks(toClose)) {
        tx.update(jobs).set({ closedAt: at }).where(inArray(jobs.id, ids)).run()
      }
      counts.closed = toClose.length
    }

    const listed = [...openIds]
    let found = 0
    for (const ids of chunks(listed)) {
      const reopened = tx
        .update(jobs)
        .set({ closedAt: null })
        .where(and(inArray(jobs.id, ids), isNotNull(jobs.closedAt)))
        .run()
      counts.reopened += reopened.changes
      found += tx.update(jobs).set({ lastSeenAt: at }).where(inArray(jobs.id, ids)).run().changes
    }
    counts.missing = listed.length - found

    tx.insert(ingestRuns)
      .values({
        runId: run.runId,
        runCreatedAt: at,
        syncedAt: now.toISOString(),
        outcome: 'synced',
        ...counts,
        report: run.reportJson,
      })
      .run()

    let report: z.infer<typeof ReportCompaniesSchema> | undefined
    try {
      report = run.reportJson
        ? ReportCompaniesSchema.safeParse(JSON.parse(run.reportJson)).data
        : undefined
    } catch {
      report = undefined // a broken report only costs the company status table
    }
    for (const c of report?.companies ?? []) {
      const values = {
        name: c.name,
        ats: c.ats,
        lastRunId: run.runId,
        lastRunAt: at,
        lastStatus: c.status,
        lastComplete: c.complete,
        lastFetched: c.fetched,
        lastKept: c.kept,
        lastError: c.error ?? null,
      }
      tx.insert(companies)
        .values({ slug: c.slug, ...values })
        .onConflictDoUpdate({ target: companies.slug, set: values })
        .run()
    }
  })

  return counts
}

// ---------- Syncing from a run source ----------

export interface SyncedRun extends Partial<RunCounts> {
  runId: string
  createdAt: string
  outcome: 'synced' | 'no_artifact' | 'expired' | 'superseded'
  url?: string
}

export interface SyncResult {
  runs: SyncedRun[]
  /** A run's results were lost (expired) or a run listed jobs we don't have. */
  gap: boolean
}

function recordSkippedRun(
  db: Db,
  runId: string,
  createdAt: string,
  outcome: 'no_artifact' | 'expired' | 'superseded',
  now: Date,
) {
  db.insert(ingestRuns)
    .values({ runId, runCreatedAt: createdAt, syncedAt: now.toISOString(), outcome })
    .onConflictDoNothing()
    .run()
}

/**
 * Pulls every successful runner run that hasn't been synced yet, oldest first.
 * Running it again right away changes nothing.
 */
export async function sync(
  db: Db,
  source: RunSource,
  now: () => Date = () => new Date(),
): Promise<SyncResult> {
  const known = new Set(
    db
      .select({ runId: ingestRuns.runId })
      .from(ingestRuns)
      .all()
      .map((r) => r.runId),
  )
  const newestSynced = db
    .select({ at: ingestRuns.runCreatedAt })
    .from(ingestRuns)
    .where(eq(ingestRuns.outcome, 'synced'))
    .orderBy(desc(ingestRuns.runCreatedAt))
    .limit(1)
    .get()?.at

  const pending = (await source.listRuns())
    .filter((r) => !known.has(r.id))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))

  const result: SyncResult = { runs: [], gap: false }
  let latest = newestSynced
  for (const run of pending) {
    // Applying a run older than one already synced would undo newer data.
    if (latest && run.createdAt < latest) {
      recordSkippedRun(db, run.id, run.createdAt, 'superseded', now())
      result.runs.push({
        runId: run.id,
        createdAt: run.createdAt,
        outcome: 'superseded',
        url: run.url,
      })
      continue
    }
    // Runs are applied one after another, in order; each depends on the last.
    // oxlint-disable-next-line no-await-in-loop
    const artifacts = await source.listArtifacts(run.id)
    const artifact = artifacts.find((a) => a.name === `ingest-${run.id}`)
    if (!artifact) {
      recordSkippedRun(db, run.id, run.createdAt, 'no_artifact', now())
      result.runs.push({
        runId: run.id,
        createdAt: run.createdAt,
        outcome: 'no_artifact',
        url: run.url,
      })
      continue
    }
    if (artifact.expired) {
      recordSkippedRun(db, run.id, run.createdAt, 'expired', now())
      result.runs.push({
        runId: run.id,
        createdAt: run.createdAt,
        outcome: 'expired',
        url: run.url,
      })
      result.gap = true
      continue
    }
    // oxlint-disable-next-line no-await-in-loop
    const files = await source.downloadArtifact(artifact)
    const counts = applyRun(db, parseRunFiles(run.id, run.createdAt, files), now())
    if (counts.missing > 0) result.gap = true
    result.runs.push({
      runId: run.id,
      createdAt: run.createdAt,
      outcome: 'synced',
      url: run.url,
      ...counts,
    })
    latest = run.createdAt
  }
  return result
}

/** Applies a local `pnpm cli ingest --out <dir>` result, for working without GitHub. */
export async function syncFromDir(db: Db, dir: string, now: Date = new Date()): Promise<SyncedRun> {
  const read = async (name: string) => {
    try {
      return await readFile(join(dir, name), 'utf8')
    } catch {
      return undefined
    }
  }
  const files: Record<string, string> = {}
  for (const name of ['jobs.jsonl', 'open.json', 'report.json']) {
    // oxlint-disable-next-line no-await-in-loop -- three small local files
    const text = await read(name)
    if (text !== undefined) files[name] = text
  }
  const parsedOpen = OpenListingSchema.safeParse(parseJson(files['open.json'] ?? ''))
  if (!parsedOpen.success) {
    throw new Error(
      `${join(dir, 'open.json')} is missing or not an ingest output (run ingest --out first)`,
    )
  }
  const open = parsedOpen.data
  const already = db
    .select({ runId: ingestRuns.runId })
    .from(ingestRuns)
    .where(eq(ingestRuns.runId, open.runId))
    .get()
  if (already) return { runId: open.runId, createdAt: open.generatedAt, outcome: 'synced' }
  const counts = applyRun(db, parseRunFiles(open.runId, open.generatedAt, files), now)
  return { runId: open.runId, createdAt: open.generatedAt, outcome: 'synced', ...counts }
}
