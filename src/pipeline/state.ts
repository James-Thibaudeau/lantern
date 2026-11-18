import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import type { Changes, IngestResult } from './ingest'
import type { Job } from './schema'

/**
 * Seen-jobs state, kept between runs (in the Action it lives in actions/cache, never in git).
 * It lists the jobs the last run sent, so the next run only sends what's new or changed.
 *
 * It only records jobs that passed the filter. So widening a profile needs no special
 * handling: jobs that start matching aren't in the state, so they go out as new.
 */
export const SeenStateSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  /** job id → content hash (h) and company slug (c). */
  jobs: z.record(z.string(), z.object({ h: z.string(), c: z.string() })),
})
export type SeenState = z.infer<typeof SeenStateSchema>

export interface StateResult {
  /** The jobs to write to jobs.jsonl: new and updated ones. */
  emit: Job[]
  changes: Changes
  next: SeenState
}

/** Reads the previous state. Missing or unreadable state means "send everything". */
export async function readState(
  path: string,
): Promise<{ state: SeenState | null; warning?: string }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { state: null }
  }
  try {
    const parsed = SeenStateSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return { state: parsed.data }
    return { state: null, warning: `Ignoring ${path}: unexpected format` }
  } catch {
    return { state: null, warning: `Ignoring ${path}: not valid JSON` }
  }
}

export async function writeState(path: string, state: SeenState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state)}\n`)
}

/**
 * Compares this run's kept jobs with the previous state.
 *
 * For companies fetched completely this run, the new state is exactly what was kept.
 * For the rest (failed, skipped, partial, or left out by --company), previous entries are
 * carried forward, so a bad day doesn't make their jobs look new tomorrow. Entries for
 * companies no longer in the config are dropped.
 */
export function applyState(
  result: Pick<IngestResult, 'kept' | 'open'>,
  previous: SeenState | null,
  configuredSlugs: string[],
  now: Date = new Date(),
): StateResult {
  const complete = new Set(result.open.completeCompanies)
  const configured = new Set(configuredSlugs)
  const next: SeenState = { version: 1, generatedAt: now.toISOString(), jobs: {} }

  for (const [id, entry] of Object.entries(previous?.jobs ?? {})) {
    if (!complete.has(entry.c) && configured.has(entry.c)) next.jobs[id] = entry
  }

  const emit: Job[] = []
  const changes: Changes = { stateFound: previous !== null, new: 0, updated: 0, unchanged: 0 }
  for (const job of result.kept) {
    const before = previous?.jobs[job.id]
    if (!before) {
      changes.new++
      emit.push(job)
    } else if (before.h !== job.contentHash) {
      changes.updated++
      emit.push(job)
    } else {
      changes.unchanged++
    }
    next.jobs[job.id] = { h: job.contentHash, c: job.companySlug }
  }

  return { emit, changes, next }
}
