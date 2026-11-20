import { eq, isNull } from 'drizzle-orm'

import { jobs } from '#/db/schema'
import {
  getTailoring as getTailoringRow,
  insertTailoring,
  listTailorings,
  setDecision,
  type TailoredResume,
} from '#/db/tailored'
import { listChanges, type Change } from '#/tailor/changes'
import type { Issue } from '#/tailor/check'
import { ClaudeCliError } from '#/tailor/claude-cli'
import { postingFrom } from '#/tailor/commands'
import { renderResume } from '#/tailor/render'
import { readTailoring, resumeFileName, storeTailoring } from '#/tailor/stored'
import { promptHash, resumeHash, tailorResume } from '#/tailor/tailor'

import { getDb, promptStatus, rankingStatus, reloadPrompt, reloadResume, resumeStatus } from './db'

// Server-only tailoring logic. The server functions in ./tailor.ts call into this module only
// from inside their handlers, so none of it (file reads, SQLite, the claude CLI) reaches the
// browser bundle.

export interface TailoringView {
  id: number
  version: number
  createdAt: string
  model: string
  /** The posting, resume.json or the tailoring prompt changed after this version was made. */
  stale: { job: boolean; resume: boolean; prompt: boolean }
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
      // Versions from before prompts were editable have no hash; don't guess about those.
      prompt: row.promptHash !== null && row.promptHash !== promptHash(promptStatus().text),
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
  // Read resume.json and the prompt fresh, so edits show up without a Sync.
  const [{ resume, message }, { text: system }] = await Promise.all([
    reloadResume(),
    reloadPrompt(),
  ])
  if (!resume) return { ok: false, message }
  try {
    const result = await tailorResume(resume, postingFrom(job), undefined, system)
    const saved = insertTailoring(db, {
      jobId,
      model: result.model,
      resumeHash: result.resumeHash,
      jobHash: job.contentHash,
      promptHash: result.promptHash,
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

// ---------- Try it (the prompt editor) ----------

export interface TryResult {
  ok: boolean
  message: string
  /** Set when ok: what the tailoring would look like. Nothing is saved. */
  result?: {
    changes: Change[]
    bulletText: Record<string, string>
    errors: Issue[]
    warnings: Issue[]
    fitNotes: { matches: string[]; gaps: string[]; interviewTopics: string[] }
    html: string
    model: string
    seconds: number
    tokens: { input: number; output: number } | null
  }
  /** The request sent with the prompt (resume and posting), when one was made. */
  request?: string
}

/**
 * Runs an unsaved prompt against one job and returns the result without storing a version.
 * Shares the one-at-a-time lock with real tailoring.
 */
export async function tryPrompt(jobId: string, system: string): Promise<TryResult> {
  if (running)
    return { ok: false, message: 'A resume is being tailored. Try again when it finishes.' }
  const job = getDb().select().from(jobs).where(eq(jobs.id, jobId)).get()
  if (!job) return { ok: false, message: 'That job is no longer in the database.' }
  const { resume, message } = await reloadResume()
  if (!resume) return { ok: false, message }

  const started = Date.now()
  const attempt = (async (): Promise<TryResult> => {
    try {
      const r = await tailorResume(resume, postingFrom(job), undefined, system)
      const final = listChanges(resume, r.tailoring)
      const fileName = resumeFileName(resume.basics.name, job.company, job.title)
      const t = readTailoring(
        storeTailoring(resume, r.tailoring),
        { ...r.checks, fitNotes: r.tailoring.fitNotes },
        {},
      )
      return {
        ok: true,
        message: 'Done. Nothing was saved.',
        request: r.request,
        result: {
          changes: final,
          bulletText: Object.fromEntries(
            resume.experience.flatMap((j) => j.bullets.map((b) => [b.id, b.text])),
          ),
          errors: r.checks.errors,
          warnings: r.checks.warnings,
          fitNotes: r.tailoring.fitNotes,
          html: t ? renderResume(t.final, { title: fileName.replace(/\.html$/, '') }) : '',
          model: r.model,
          seconds: Math.round((Date.now() - started) / 1000),
          tokens: r.usage
            ? {
                input: r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheCreationTokens,
                output: r.usage.outputTokens,
              }
            : null,
        },
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        message: err instanceof ClaudeCliError ? reason : `Tailoring failed: ${reason}`,
      }
    }
  })()
  const promise = attempt.then((r) => ({ ok: r.ok, message: r.message }))
  running = { jobId, promise }
  try {
    return await attempt
  } finally {
    running = undefined
  }
}

/** Open jobs to try a prompt on: the best-ranked first. */
export function jobsToTry(
  limit = 40,
): { id: string; title: string; company: string; score: number | null }[] {
  const score = rankingStatus().score
  const rows = getDb().select().from(jobs).where(isNull(jobs.closedAt)).all()
  return rows
    .map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      firstSeenAt: j.firstSeenAt,
      s: score?.(j) ?? null,
    }))
    .toSorted(
      (a, b) =>
        Number(Boolean(a.s?.dealbreaker)) - Number(Boolean(b.s?.dealbreaker)) ||
        (b.s?.score ?? 0) - (a.s?.score ?? 0) ||
        b.firstSeenAt.localeCompare(a.firstSeenAt),
    )
    .slice(0, limit)
    .map(({ id, title, company, s }) => ({ id, title, company, score: s?.score ?? null }))
}
