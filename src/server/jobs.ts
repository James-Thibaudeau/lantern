import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { JobSchema, type Job } from '#/pipeline/schema'

/** What the jobs page needs per job: everything except the heavy HTML description. */
export type JobRow = Omit<Job, 'descriptionHtml'>

// Just the parts of report.json this page shows.
const RunSummary = z.object({
  runId: z.string(),
  finishedAt: z.string(),
  totals: z.object({
    ok: z.number(),
    companies: z.number(),
    fetched: z.number(),
    kept: z.number(),
  }),
})

export interface JobsData {
  jobs: JobRow[]
  run: z.infer<typeof RunSummary> | null
  /** Set when there's no ingest output to show yet. */
  missing: string | null
}

// Until local sync into SQLite exists (build step 7), the page reads the last
// `pnpm cli ingest` output straight from disk.
const OUT_DIR = process.env.LANTERN_OUT_DIR ?? 'out'

/**
 * A server function: this handler only ever runs on the server (so it can use node:fs),
 * and TanStack Start turns calls to it from the browser into an HTTP request.
 */
export const getJobs = createServerFn({ method: 'GET' }).handler(async (): Promise<JobsData> => {
  const jobsPath = join(OUT_DIR, 'jobs.jsonl')
  let jsonl: string
  try {
    jsonl = await readFile(jobsPath, 'utf8')
  } catch {
    return { jobs: [], run: null, missing: jobsPath }
  }

  const jobs = jsonl
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      // Validating costs little and catches output written by an older pipeline version.
      const { descriptionHtml: _html, ...row } = JobSchema.parse(JSON.parse(line))
      return row
    })
    .toSorted((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))

  let run: JobsData['run'] = null
  try {
    const report = JSON.parse(await readFile(join(OUT_DIR, 'report.json'), 'utf8'))
    run = RunSummary.safeParse(report).data ?? null
  } catch {
    // The report is optional for this page.
  }

  return { jobs, run, missing: null }
})
