import { eq } from 'drizzle-orm'

import { jobs } from '#/db/schema'
import {
  getTailoring as getTailoringRow,
  insertTailoring,
  listTailorings,
  setDecision,
  type TailoredResume,
} from '#/db/tailored'
import type { Change } from '#/tailor/changes'
import type { Issue } from '#/tailor/check'
import { ClaudeCliError } from '#/tailor/claude-cli'
import { postingFrom } from '#/tailor/commands'
import { renderResume } from '#/tailor/render'
import { readTailoring, resumeFileName, storeTailoring } from '#/tailor/stored'
import { resumeHash, tailorResume } from '#/tailor/tailor'

import { getDb, reloadResume, resumeStatus } from './db'

// Server-only tailoring logic. The server functions in ./tailor.ts call into this module only
// from inside their handlers, so none of it (file reads, SQLite, the claude CLI) reaches the
// browser bundle.

export interface TailoringView {
  id: number
  version: number
  createdAt: string
  model: string
  /** The posting or resume.json changed after this version was made. */
  stale: { job: boolean; resume: boolean }
  changes: Change[]
  /** Master bullet texts by id, for showing which bullets were dropped or reordered. */
  bulletText: Record<string, string>
  decisions: Record<string, boolean>
  errors: Issue[]
  warnings: Issue[]
  fitNotes: { matches: string[]; gaps: string[]; interviewTopics: string[] }
  /** The final resume (your decisions applied) as a standalone HTML document. */
  html: string
  fileName: string
}

export interface TailoringData {
  current: TailoringView | null
  versions: { id: number; version: number; createdAt: string }[]
  resume: { ready: boolean; ok: boolean; message: string }
  /** A tailoring for this job is in progress. */
  running: boolean
}

let running: { jobId: string; promise: Promise<TailorOutcome> } | undefined

export function view(row: TailoredResume): TailoringView | null {
  const db = getDb()
  const job = db
    .select({ title: jobs.title, company: jobs.company, contentHash: jobs.contentHash })
    .from(jobs)
    .where(eq(jobs.id, row.jobId))
    .get()
  const t = readTailoring(row.tailoring, row.checks, row.decisions)
  if (!t || !job) return null
  const current = resumeStatus().resume
  const fileName = resumeFileName(t.final.basics.name, job.company, job.title)
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    model: row.model,
    stale: {
      job: job.contentHash !== row.jobHash,
      resume: current !== null && resumeHash(current) !== row.resumeHash,
    },
    changes: t.changes,
    bulletText: Object.fromEntries(
      t.master.experience.flatMap((j) => j.bullets.map((b) => [b.id, b.text])),
    ),
    decisions: row.decisions,
    errors: t.checks.errors,
    warnings: t.checks.warnings,
    fitNotes: t.checks.fitNotes,
    html: renderResume(t.final, { title: fileName.replace(/\.html$/, '') }),
    fileName,
  }
}

export function tailoringData(jobId: string, id?: number): TailoringData {
  const db = getDb()
  const rows = listTailorings(db, jobId)
  const row = (id !== undefined ? rows.find((r) => r.id === id) : undefined) ?? rows[0]
  const status = resumeStatus()
  return {
    current: row ? view(row) : null,
    versions: rows.map((r) => ({ id: r.id, version: r.version, createdAt: r.createdAt })),
    resume: { ready: status.resume !== null, ok: status.ok, message: status.message },
    running: running?.jobId === jobId,
  }
}

export type TailorOutcome = { ok: boolean; message: string }

async function runTailoring(jobId: string): Promise<TailorOutcome> {
  const db = getDb()
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()
  if (!job) return { ok: false, message: 'That job is no longer in the database. Try Sync.' }
  // Read resume.json fresh, so edits show up without a Sync.
  const { resume, message } = await reloadResume()
  if (!resume) return { ok: false, message }
  try {
    const result = await tailorResume(resume, postingFrom(job))
    const saved = insertTailoring(db, {
      jobId,
      model: result.model,
      resumeHash: result.resumeHash,
      jobHash: job.contentHash,
      tailoring: storeTailoring(resume, result.tailoring),
      checks: { ...result.checks, fitNotes: result.tailoring.fitNotes },
      usage: result.usage,
    })
    return { ok: true, message: `Tailored (version ${saved.version}).` }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      message: err instanceof ClaudeCliError ? reason : `Tailoring failed: ${reason}`,
    }
  }
}

/** Starts tailoring (or joins the one running for this job). One tailoring at a time. */
export async function startTailoring(
  jobId: string,
): Promise<TailorOutcome & { data: TailoringData }> {
  if (running && running.jobId !== jobId) {
    return {
      ok: false,
      message: 'Another resume is being tailored. Try again when it finishes.',
      data: tailoringData(jobId),
    }
  }
  if (!running) {
    const promise = runTailoring(jobId).finally(() => {
      running = undefined
    })
    running = { jobId, promise }
  }
  const outcome = await running.promise
  return { ...outcome, data: tailoringData(jobId) }
}

/** Accept or revert one change; returns that version's data. */
export function decide(id: number, change: string, accepted: boolean): TailoringData | null {
  const row = setDecision(getDb(), id, change, accepted)
  return row ? tailoringData(row.jobId, row.id) : null
}

/** The final resume of one version as a standalone HTML file (for /print/resume/:id). */
export function printableResume(id: number): { html: string; fileName: string } | null {
  const row = getTailoringRow(getDb(), id)
  const v = row ? view(row) : null
  return v ? { html: v.html, fileName: v.fileName } : null
}
