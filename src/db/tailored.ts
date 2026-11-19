import { desc, eq, max } from 'drizzle-orm'
import { z } from 'zod'

import type { Db } from './index'
import { jobs, tailoredResumes, type TailoredResumeRow } from './schema'

export interface NewTailoring {
  jobId: string
  model: string
  resumeHash: string
  jobHash: string
  tailoring: unknown
  checks: unknown
  usage?: unknown
  /** ISO 8601; defaults to now. */
  createdAt?: string
}

/** A tailored resume version with its JSON columns parsed (callers validate the shapes). */
export interface TailoredResume {
  id: number
  jobId: string
  version: number
  createdAt: string
  model: string
  resumeHash: string
  jobHash: string
  tailoring: unknown
  checks: unknown
  /** Change key → accepted. */
  decisions: Record<string, boolean>
  usage: unknown
}

const Decisions = z.record(z.string(), z.boolean())

/** Parses stored JSON; a corrupt value reads as null rather than throwing. */
function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return null
  }
}

function parseDecisions(text: string): Record<string, boolean> {
  const parsed = Decisions.safeParse(parseJson(text))
  return parsed.success ? parsed.data : {}
}

function toTailoredResume(row: TailoredResumeRow): TailoredResume {
  return {
    id: row.id,
    jobId: row.jobId,
    version: row.version,
    createdAt: row.createdAt,
    model: row.model,
    resumeHash: row.resumeHash,
    jobHash: row.jobHash,
    tailoring: parseJson(row.tailoring),
    checks: parseJson(row.checks),
    decisions: parseDecisions(row.decisions),
    usage: parseJson(row.usage),
  }
}

/** Stores a new tailoring as the job's next version (1 for its first). */
export function insertTailoring(db: Db, t: NewTailoring): TailoredResume {
  return db.transaction((tx) => {
    const previous =
      tx
        .select({ v: max(tailoredResumes.version) })
        .from(tailoredResumes)
        .where(eq(tailoredResumes.jobId, t.jobId))
        .get()?.v ?? 0
    const row = tx
      .insert(tailoredResumes)
      .values({
        jobId: t.jobId,
        version: previous + 1,
        createdAt: t.createdAt ?? new Date().toISOString(),
        model: t.model,
        resumeHash: t.resumeHash,
        jobHash: t.jobHash,
        tailoring: JSON.stringify(t.tailoring ?? null),
        checks: JSON.stringify(t.checks ?? null),
        usage: t.usage === undefined ? null : JSON.stringify(t.usage),
      })
      .returning()
      .get()
    return toTailoredResume(row)
  })
}

export function getTailoring(db: Db, id: number): TailoredResume | undefined {
  const row = db.select().from(tailoredResumes).where(eq(tailoredResumes.id, id)).get()
  return row ? toTailoredResume(row) : undefined
}

/** All versions for a job, newest first. */
export function listTailorings(db: Db, jobId: string): TailoredResume[] {
  return db
    .select()
    .from(tailoredResumes)
    .where(eq(tailoredResumes.jobId, jobId))
    .orderBy(desc(tailoredResumes.version))
    .all()
    .map(toTailoredResume)
}

export function latestTailoring(db: Db, jobId: string): TailoredResume | undefined {
  const row = db
    .select()
    .from(tailoredResumes)
    .where(eq(tailoredResumes.jobId, jobId))
    .orderBy(desc(tailoredResumes.version))
    .limit(1)
    .get()
  return row ? toTailoredResume(row) : undefined
}

/** Records whether one change was accepted. Returns undefined when there's no such tailoring. */
export function setDecision(
  db: Db,
  id: number,
  change: string,
  accepted: boolean,
): TailoredResume | undefined {
  return db.transaction((tx) => {
    const row = tx.select().from(tailoredResumes).where(eq(tailoredResumes.id, id)).get()
    if (!row) return undefined
    const decisions = { ...parseDecisions(row.decisions), [change]: accepted }
    const updated = tx
      .update(tailoredResumes)
      .set({ decisions: JSON.stringify(decisions) })
      .where(eq(tailoredResumes.id, id))
      .returning()
      .get()
    return toTailoredResume(updated)
  })
}

/**
 * Sets (or with null, clears) the tailored resume you applied to a job with.
 * Returns false when there's no job with that id.
 */
export function setAppliedResume(db: Db, jobId: string, tailoredId: number | null): boolean {
  return (
    db.update(jobs).set({ appliedResumeId: tailoredId }).where(eq(jobs.id, jobId)).run().changes > 0
  )
}
